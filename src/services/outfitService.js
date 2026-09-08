// An outfit is a named collection of garments with a rating, free-text notes and
// tags. Every query is scoped to the owning user. See plan/outfitler_overview.md §2.

const withTransaction = require('../db/withTransaction');
const tagService = require('./tagService');
const garmentService = require('./garmentService');

const OUTFIT_SELECT = `outfits.*,
  (SELECT count(*)::int FROM outfit_wears w WHERE w.outfit_id = outfits.id) AS wear_count,
  (SELECT to_char(max(w.worn_on), 'YYYY-MM-DD') FROM outfit_wears w WHERE w.outfit_id = outfits.id) AS last_worn_on`;

const ORDER = {
  rating: 'outfits.rating DESC NULLS LAST, outfits.created_at DESC',
  most_worn: 'wear_count DESC, outfits.created_at DESC',
  last_worn: 'last_worn_on DESC NULLS LAST, outfits.created_at DESC',
  created: 'outfits.created_at DESC',
};

const serialize = (row, tags, garmentIds) => ({
  id: row.id,
  name: row.name,
  rating: row.rating,
  notes: row.notes,
  garmentIds: garmentIds || [],
  tags: tags || [],
  wearCount: row.wear_count ?? 0,
  lastWornOn: row.last_worn_on || null,
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

const selectById = async (db, id) => {
  const { rows } = await db.query(`SELECT ${OUTFIT_SELECT} FROM outfits WHERE outfits.id = $1`, [id]);
  return rows[0] || null;
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
  const where = ['outfits.user_id = $1'];
  const params = [userId];

  if (filters.rating) {
    params.push(filters.rating);
    where.push(`outfits.rating = $${params.length}`);
  }

  const tagNames = (filters.tag || []).map((t) => t.toLowerCase());
  if (tagNames.length > 0) {
    params.push(tagNames);
    const idx = params.length;
    const joined = `outfit_tags ot JOIN tags t ON t.id = ot.tag_id
       WHERE ot.outfit_id = outfits.id AND t.user_id = $1
         AND lower(t.name) = ANY($${idx}::text[])`;
    if (filters.match === 'all') {
      where.push(`(SELECT count(DISTINCT lower(t.name)) FROM ${joined}) = ${tagNames.length}`);
    } else {
      where.push(`EXISTS (SELECT 1 FROM ${joined})`);
    }
  }

  const orderBy = ORDER[filters.sort] || ORDER.created;
  const { rows } = await pool.query(
    `SELECT ${OUTFIT_SELECT} FROM outfits WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`,
    params
  );
  return withMeta(pool, rows);
};

const getById = async (pool, userId, id) => {
  const { rows } = await pool.query(
    `SELECT ${OUTFIT_SELECT} FROM outfits WHERE outfits.id = $1 AND outfits.user_id = $2`,
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
      'INSERT INTO outfits (user_id, name, rating, notes) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, data.name, data.rating ?? null, data.notes ?? null]
    );
    const id = rows[0].id;
    await replaceGarments(client, id, data.garmentIds || []);
    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, userId, data.tags);
      await tagService.replaceLinks(client, 'outfit', id, tagIds);
    }
    return (await withMeta(client, [await selectById(client, id)]))[0];
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

    return (await withMeta(client, [await selectById(client, id)]))[0];
  });

// Record that the outfit was worn on `wornOn` (YYYY-MM-DD): one outfit_wears row
// plus one garment_wears row per garment currently in the outfit.
const recordWear = async (pool, userId, id, wornOn) =>
  withTransaction(pool, async (client) => {
    const owned = await client.query(
      'SELECT id FROM outfits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (owned.rows.length === 0) return null;

    await client.query(
      'INSERT INTO outfit_wears (outfit_id, user_id, worn_on) VALUES ($1, $2, $3)',
      [id, userId, wornOn]
    );
    await client.query(
      `INSERT INTO garment_wears (garment_id, user_id, worn_on, outfit_id)
       SELECT og.garment_id, $2, $3, $1 FROM outfit_garments og WHERE og.outfit_id = $1`,
      [id, userId, wornOn]
    );

    const outfit = (await withMeta(client, [await selectById(client, id)]))[0];
    outfit.garments = await garmentService.listByIds(client, userId, outfit.garmentIds);
    return outfit;
  });

const remove = async (pool, userId, id) => {
  const { rowCount } = await pool.query(
    'DELETE FROM outfits WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
};

module.exports = { list, getById, create, update, recordWear, remove };
