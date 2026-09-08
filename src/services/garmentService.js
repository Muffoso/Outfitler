// A garment is a photo (max one) with a rating, free-text notes and tags. Every
// query is scoped to the owning user. See plan/outfitler_overview.md §2 and
// plan/image_storage.md.

const withTransaction = require('../db/withTransaction');
const tagService = require('./tagService');
const imageStore = require('./imageStore');

// garments.* plus derived wear stats.
const GARMENT_SELECT = `garments.*,
  (SELECT count(*)::int FROM garment_wears w WHERE w.garment_id = garments.id) AS wear_count,
  (SELECT to_char(max(w.worn_on), 'YYYY-MM-DD') FROM garment_wears w WHERE w.garment_id = garments.id) AS last_worn_on`;

const ORDER = {
  rating: 'garments.rating DESC NULLS LAST, garments.created_at DESC',
  most_worn: 'wear_count DESC, garments.created_at DESC',
  last_worn: 'last_worn_on DESC NULLS LAST, garments.created_at DESC',
  created: 'garments.created_at DESC',
};

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
  wearCount: row.wear_count ?? 0,
  lastWornOn: row.last_worn_on || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const hydrate = async (db, rows) => {
  const tagMap = await tagService.namesByOwner(db, 'garment', rows.map((r) => r.id));
  return Promise.all(rows.map((r) => serialize(r, tagMap.get(r.id))));
};

const selectById = async (db, id) => {
  const { rows } = await db.query(`SELECT ${GARMENT_SELECT} FROM garments WHERE garments.id = $1`, [id]);
  return rows[0] || null;
};

const list = async (pool, userId, filters = {}) => {
  const where = ['garments.user_id = $1'];
  const params = [userId];

  const archived = filters.archived || 'false';
  if (archived === 'true') where.push('garments.archived = true');
  else if (archived !== 'all') where.push('garments.archived = false');

  if (filters.rating) {
    params.push(filters.rating);
    where.push(`garments.rating = $${params.length}`);
  }

  const tagNames = (filters.tag || []).map((t) => t.toLowerCase());
  if (tagNames.length > 0) {
    params.push(tagNames);
    const idx = params.length;
    const joined = `garment_tags gt JOIN tags t ON t.id = gt.tag_id
       WHERE gt.garment_id = garments.id AND t.user_id = $1
         AND lower(t.name) = ANY($${idx}::text[])`;
    if (filters.match === 'all') {
      where.push(`(SELECT count(DISTINCT lower(t.name)) FROM ${joined}) = ${tagNames.length}`);
    } else {
      where.push(`EXISTS (SELECT 1 FROM ${joined})`);
    }
  }

  const orderBy = ORDER[filters.sort] || ORDER.created;
  const { rows } = await pool.query(
    `SELECT ${GARMENT_SELECT} FROM garments WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`,
    params
  );
  return hydrate(pool, rows);
};

const listByIds = async (pool, userId, ids) => {
  if (!ids || ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT ${GARMENT_SELECT} FROM garments WHERE garments.id = ANY($1::uuid[]) AND garments.user_id = $2`,
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
  const { rows } = await pool.query(
    `SELECT ${GARMENT_SELECT} FROM garments WHERE garments.id = $1 AND garments.user_id = $2`,
    [id, userId]
  );
  if (rows.length === 0) return null;
  return (await hydrate(pool, rows))[0];
};

const create = async (pool, userId, data) =>
  withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      'INSERT INTO garments (user_id, rating, notes) VALUES ($1, $2, $3) RETURNING id',
      [userId, data.rating ?? null, data.notes ?? null]
    );
    const id = rows[0].id;
    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, userId, data.tags);
      await tagService.replaceLinks(client, 'garment', id, tagIds);
    }
    return (await hydrate(client, [await selectById(client, id)]))[0];
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

    return (await hydrate(client, [await selectById(client, id)]))[0];
  });

const setImage = async (pool, userId, id, img) => {
  const { rowCount } = await pool.query(
    `UPDATE garments SET
       image_key_prefix = $1, image_variants = $2, image_width = $3,
       image_height = $4, image_bytes = $5, image_hash = $6,
       image_updated_at = NOW(), updated_at = NOW()
     WHERE id = $7 AND user_id = $8`,
    [img.keyPrefix, JSON.stringify(img.variants), img.width, img.height, img.bytes, img.hash, id, userId]
  );
  if (rowCount === 0) return null;
  return (await hydrate(pool, [await selectById(pool, id)]))[0];
};

const clearImage = async (pool, userId, id) => {
  const { rowCount } = await pool.query(
    `UPDATE garments SET
       image_key_prefix = NULL, image_variants = NULL, image_width = NULL,
       image_height = NULL, image_bytes = NULL, image_hash = NULL,
       image_updated_at = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (rowCount === 0) return null;
  return (await hydrate(pool, [await selectById(pool, id)]))[0];
};

// Record that the garment was worn on `wornOn` (YYYY-MM-DD).
const addWear = async (pool, userId, id, wornOn) => {
  const { rowCount } = await pool.query(
    `INSERT INTO garment_wears (garment_id, user_id, worn_on)
     SELECT id, $2, $3 FROM garments WHERE id = $1 AND user_id = $2`,
    [id, userId, wornOn]
  );
  if (rowCount === 0) return null;
  return getById(pool, userId, id);
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
  list, listByIds, getRow, getById, create, update, setImage, clearImage, addWear, remove,
};
