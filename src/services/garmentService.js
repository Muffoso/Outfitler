// A garment is a photo (added in a later phase) with a rating, free-text notes
// and tags. Every query is scoped to the owning user. See
// plan/outfitler_overview.md §2 and plan/image_storage_implementation.md Fas 3.

const withTransaction = require('../db/withTransaction');
const tagService = require('./tagService');

const serialize = (row, tags) => ({
  id: row.id,
  rating: row.rating,
  notes: row.notes,
  archived: row.archived,
  image: null, // populated with signed URLs in Fas 5
  tags: tags || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const withTags = async (db, rows) => {
  const tagMap = await tagService.namesByOwner(db, 'garment', rows.map((r) => r.id));
  return rows.map((r) => serialize(r, tagMap.get(r.id)));
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
  return withTags(pool, rows);
};

const listByIds = async (pool, userId, ids) => {
  if (!ids || ids.length === 0) return [];
  const { rows } = await pool.query(
    'SELECT * FROM garments WHERE id = ANY($1::uuid[]) AND user_id = $2',
    [ids, userId]
  );
  const serialized = await withTags(pool, rows);
  const byId = new Map(serialized.map((g) => [g.id, g]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

const getById = async (pool, userId, id) => {
  const { rows } = await pool.query(
    'SELECT * FROM garments WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (rows.length === 0) return null;
  return (await withTags(pool, rows))[0];
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
    return (await withTags(client, [garment]))[0];
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
    return (await withTags(client, rows))[0];
  });

const remove = async (pool, userId, id) => {
  const { rowCount } = await pool.query(
    'DELETE FROM garments WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
};

module.exports = { list, listByIds, getById, create, update, remove };
