// A garment is a photo (max one) with a rating, free-text notes and tags. Every
// query is scoped to the owning user. See plan/outfitler_overview.md §2 and
// plan/image_storage.md.

const withTransaction = require('../db/withTransaction');
const tagService = require('./tagService');
const imageStore = require('./imageStore');

const buildImage = async (row) => {
  if (!row.image_key_prefix) return null;
  const dims = row.image_variants || {};
  const [thumb, card, archive] = await Promise.all([
    imageStore.signedUrl(`${row.image_key_prefix}/thumb.webp`),
    imageStore.signedUrl(`${row.image_key_prefix}/card.webp`),
    imageStore.signedUrl(`${row.image_key_prefix}/archive.webp`),
  ]);
  return {
    thumb: { url: thumb, ...(dims.thumb || {}) },
    card: { url: card, ...(dims.card || {}) },
    archive: { url: archive, ...(dims.archive || {}) },
    width: row.image_width,
    height: row.image_height,
  };
};

const serialize = async (row, tags) => ({
  id: row.id,
  rating: row.rating,
  notes: row.notes,
  archived: row.archived,
  image: await buildImage(row),
  tags: tags || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const hydrate = async (db, rows) => {
  const tagMap = await tagService.namesByOwner(db, 'garment', rows.map((r) => r.id));
  return Promise.all(rows.map((r) => serialize(r, tagMap.get(r.id))));
};

const list = async (pool, userId, filters = {}) => {
  const where = ['user_id = $1'];
  const params = [userId];

  const archived = filters.archived || 'false';
  if (archived === 'true') where.push('archived = true');
  else if (archived !== 'all') where.push('archived = false');

  if (filters.rating) {
    params.push(filters.rating);
    where.push(`rating = $${params.length}`);
  }
  if (filters.tag) {
    params.push(filters.tag);
    where.push(
      `EXISTS (SELECT 1 FROM garment_tags gt JOIN tags t ON t.id = gt.tag_id
               WHERE gt.garment_id = garments.id AND t.user_id = $1
                 AND lower(t.name) = lower($${params.length}))`
    );
  }

  const { rows } = await pool.query(
    `SELECT * FROM garments WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  return hydrate(pool, rows);
};

const listByIds = async (pool, userId, ids) => {
  if (!ids || ids.length === 0) return [];
  const { rows } = await pool.query(
    'SELECT * FROM garments WHERE id = ANY($1::uuid[]) AND user_id = $2',
    [ids, userId]
  );
  const serialized = await hydrate(pool, rows);
  const byId = new Map(serialized.map((g) => [g.id, g]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

// Raw row (with image_* columns) for internal use by the image routes.
const getRow = async (pool, userId, id) => {
  const { rows } = await pool.query(
    'SELECT * FROM garments WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
};

const getById = async (pool, userId, id) => {
  const row = await getRow(pool, userId, id);
  if (!row) return null;
  return (await hydrate(pool, [row]))[0];
};

const create = async (pool, userId, data) =>
  withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      'INSERT INTO garments (user_id, rating, notes) VALUES ($1, $2, $3) RETURNING *',
      [userId, data.rating ?? null, data.notes ?? null]
    );
    const garment = rows[0];
    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, userId, data.tags);
      await tagService.replaceLinks(client, 'garment', garment.id, tagIds);
    }
    return (await hydrate(client, [garment]))[0];
  });

const update = async (pool, userId, id, data) =>
  withTransaction(pool, async (client) => {
    const owned = await client.query(
      'SELECT id FROM garments WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (owned.rows.length === 0) return null;

    const sets = [];
    const params = [];
    for (const field of ['rating', 'notes', 'archived']) {
      if (field in data) {
        params.push(data[field]);
        sets.push(`${field} = $${params.length}`);
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      params.push(id);
      await client.query(
        `UPDATE garments SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }

    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, userId, data.tags || []);
      await tagService.replaceLinks(client, 'garment', id, tagIds);
    }

    const { rows } = await client.query('SELECT * FROM garments WHERE id = $1', [id]);
    return (await hydrate(client, rows))[0];
  });

// Point the garment at a freshly uploaded image. `img` carries keyPrefix,
// variants ({thumb:{w,h},...}), width, height, bytes, hash.
const setImage = async (pool, userId, id, img) => {
  const { rows } = await pool.query(
    `UPDATE garments SET
       image_key_prefix = $1, image_variants = $2, image_width = $3,
       image_height = $4, image_bytes = $5, image_hash = $6,
       image_updated_at = NOW(), updated_at = NOW()
     WHERE id = $7 AND user_id = $8 RETURNING *`,
    [img.keyPrefix, JSON.stringify(img.variants), img.width, img.height, img.bytes, img.hash, id, userId]
  );
  if (rows.length === 0) return null;
  return (await hydrate(pool, rows))[0];
};

const clearImage = async (pool, userId, id) => {
  const { rows } = await pool.query(
    `UPDATE garments SET
       image_key_prefix = NULL, image_variants = NULL, image_width = NULL,
       image_height = NULL, image_bytes = NULL, image_hash = NULL,
       image_updated_at = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId]
  );
  if (rows.length === 0) return null;
  return (await hydrate(pool, rows))[0];
};

const remove = async (pool, userId, id) => {
  const row = await getRow(pool, userId, id);
  if (!row) return false;
  await pool.query('DELETE FROM garments WHERE id = $1 AND user_id = $2', [id, userId]);
  if (row.image_key_prefix) {
    await imageStore.delPrefix(row.image_key_prefix)
      .catch((err) => console.error('R2 cleanup after garment delete failed:', err));
  }
  return true;
};

module.exports = {
  list, listByIds, getRow, getById, create, update, setImage, clearImage, remove,
};
