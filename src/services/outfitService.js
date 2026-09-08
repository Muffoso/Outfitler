// An outfit is a named collection of garments with a rating, free-text notes and
// tags. Every query is scoped to the owning user. See plan/outfitler_overview.md §2.

const withTransaction = require('../db/withTransaction');
const tagService = require('./tagService');
const garmentService = require('./garmentService');

const serialize = (row, tags, garmentIds) => ({
  id: row.id,
  name: row.name,
  rating: row.rating,
  notes: row.notes,
  garmentIds: garmentIds || [],
  tags: tags || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const garmentIdsByOutfit = async (db, outfitIds) => {
  const map = new Map(outfitIds.map((id) => [id, []]));
  if (outfitIds.length === 0) return map;
  const { rows } = await db.query(
    `SELECT outfit_id, garment_id FROM outfit_garments
     WHERE outfit_id = ANY($1::uuid[])
     ORDER BY position, garment_id`,
    [outfitIds]
  );
  for (const row of rows) {
    (map.get(row.outfit_id) || []).push(row.garment_id);
  }
  return map;
};

const withMeta = async (db, rows) => {
  const ids = rows.map((r) => r.id);
  const [tagMap, garmentMap] = await Promise.all([
    tagService.namesByOwner(db, 'outfit', ids),
    garmentIdsByOutfit(db, ids),
  ]);
  return rows.map((r) => serialize(r, tagMap.get(r.id), garmentMap.get(r.id)));
};

// Throws GARMENT_NOT_FOUND unless every id is a garment owned by the user.
const assertGarmentsOwned = async (db, userId, garmentIds) => {
  const unique = [...new Set(garmentIds || [])];
  if (unique.length === 0) return;
  const { rows } = await db.query(
    'SELECT id FROM garments WHERE id = ANY($1::uuid[]) AND user_id = $2',
    [unique, userId]
  );
  if (rows.length !== unique.length) {
    const err = new Error('One or more garments not found');
    err.code = 'GARMENT_NOT_FOUND';
    throw err;
  }
};

const replaceGarments = async (db, outfitId, garmentIds) => {
  await db.query('DELETE FROM outfit_garments WHERE outfit_id = $1', [outfitId]);
  const unique = [...new Set(garmentIds || [])];
  if (unique.length > 0) {
    await db.query(
      `INSERT INTO outfit_garments (outfit_id, garment_id, position)
       SELECT $1, g.id, g.ord - 1
       FROM unnest($2::uuid[]) WITH ORDINALITY AS g(id, ord)`,
      [outfitId, unique]
    );
  }
};

const list = async (pool, userId, filters = {}) => {
  const where = ['user_id = $1'];
  const params = [userId];

  if (filters.rating) {
    params.push(filters.rating);
    where.push(`rating = $${params.length}`);
  }
  if (filters.tag) {
    params.push(filters.tag);
    where.push(
      `EXISTS (SELECT 1 FROM outfit_tags ot JOIN tags t ON t.id = ot.tag_id
               WHERE ot.outfit_id = outfits.id AND t.user_id = $1
                 AND lower(t.name) = lower($${params.length}))`
    );
  }

  const { rows } = await pool.query(
    `SELECT * FROM outfits WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  return withMeta(pool, rows);
};

const getById = async (pool, userId, id) => {
  const { rows } = await pool.query(
    'SELECT * FROM outfits WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (rows.length === 0) return null;
  const outfit = (await withMeta(pool, rows))[0];
  outfit.garments = await garmentService.listByIds(pool, userId, outfit.garmentIds);
  return outfit;
};

const create = async (pool, userId, data) =>
  withTransaction(pool, async (client) => {
    await assertGarmentsOwned(client, userId, data.garmentIds);
    const { rows } = await client.query(
      'INSERT INTO outfits (user_id, name, rating, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, data.name, data.rating ?? null, data.notes ?? null]
    );
    const outfit = rows[0];
    await replaceGarments(client, outfit.id, data.garmentIds || []);
    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, userId, data.tags);
      await tagService.replaceLinks(client, 'outfit', outfit.id, tagIds);
    }
    return (await withMeta(client, [outfit]))[0];
  });

const update = async (pool, userId, id, data) =>
  withTransaction(pool, async (client) => {
    const owned = await client.query(
      'SELECT id FROM outfits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (owned.rows.length === 0) return null;

    const sets = [];
    const params = [];
    for (const field of ['name', 'rating', 'notes']) {
      if (field in data) {
        params.push(data[field]);
        sets.push(`${field} = $${params.length}`);
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      params.push(id);
      await client.query(
        `UPDATE outfits SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }

    if (data.garmentIds !== undefined) {
      await assertGarmentsOwned(client, userId, data.garmentIds);
      await replaceGarments(client, id, data.garmentIds);
    }
    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, userId, data.tags || []);
      await tagService.replaceLinks(client, 'outfit', id, tagIds);
    }

    const { rows } = await client.query('SELECT * FROM outfits WHERE id = $1', [id]);
    return (await withMeta(client, rows))[0];
  });

const remove = async (pool, userId, id) => {
  const { rowCount } = await pool.query(
    'DELETE FROM outfits WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
};

module.exports = { list, getById, create, update, remove };
