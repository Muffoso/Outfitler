// An outfit is a named collection of garments with ratings, free-text notes and
// tags. Reads are scoped (bare userId string = owner === viewer, or
// { ownerId, viewerId } for a friend visit); write paths stay owner-only. See
// plan/outfitler_overview.md §2, §9.

const withTransaction = require('../db/withTransaction');
const tagService = require('./tagService');
const ratingService = require('./ratingService');
const garmentService = require('./garmentService');
const imageStore = require('./imageStore');
const { buildImage } = require('./imageUrls');
const { normalizeScope } = require('./scope');

// $1 is always viewerId.
const OUTFIT_SELECT = `outfits.*,
  (SELECT count(*)::int FROM outfit_wears w WHERE w.outfit_id = outfits.id) AS wear_count,
  (SELECT to_char(max(w.worn_on), 'YYYY-MM-DD') FROM outfit_wears w WHERE w.outfit_id = outfits.id) AS last_worn_on,
  (SELECT round(avg(value)::numeric, 2) FROM outfit_ratings r WHERE r.outfit_id = outfits.id) AS avg_rating,
  (SELECT count(*)::int FROM outfit_ratings r WHERE r.outfit_id = outfits.id) AS rating_count,
  (SELECT value FROM outfit_ratings r WHERE r.outfit_id = outfits.id AND r.user_id = $1) AS viewer_rating`;

const ORDER = {
  rating: 'viewer_rating DESC NULLS LAST, outfits.created_at DESC',
  avg_rating: 'avg_rating DESC NULLS LAST, rating_count DESC, outfits.created_at DESC',
  most_worn: 'wear_count DESC, outfits.created_at DESC',
  last_worn: 'last_worn_on DESC NULLS LAST, outfits.created_at DESC',
  created: 'outfits.created_at DESC',
};

const serialize = async (row, tags, garmentIds, ratings, isOwner) => ({
  id: row.id,
  name: row.name,
  rating: row.viewer_rating ?? null,
  myRating: row.viewer_rating ?? null,
  avgRating: row.avg_rating != null ? Number(row.avg_rating) : null,
  ratingCount: row.rating_count ?? 0,
  ratings: ratings || [],
  notes: isOwner ? row.notes : undefined,
  garmentIds: garmentIds || [],
  tags: tags || [],
  image: await buildImage(row),
  status: row.status,
  suggestedBy: row.suggested_by || null,
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

const withMeta = async (db, rows, opts = {}) => {
  const { isOwner = true, withRatings = false } = opts;
  const ids = rows.map((r) => r.id);
  const [tagMap, garmentMap, ratingMap] = await Promise.all([
    tagService.namesByOwner(db, 'outfit', ids),
    garmentIdsByOutfit(db, ids),
    withRatings ? ratingService.peopleByItem(db, 'outfit', ids) : Promise.resolve(new Map()),
  ]);
  return Promise.all(rows.map((r) => serialize(r, tagMap.get(r.id), garmentMap.get(r.id), ratingMap.get(r.id), isOwner)));
};

const selectById = async (db, viewerId, id) => {
  const { rows } = await db.query(`SELECT ${OUTFIT_SELECT} FROM outfits WHERE outfits.id = $2`, [viewerId, id]);
  return rows[0] || null;
};

// Throws GARMENT_NOT_FOUND unless every id is a garment in the owner's wardrobe
// that is usable by this scope: active, or suggested by this viewer.
const assertGarmentsUsable = async (db, scope, garmentIds) => {
  const { ownerId, viewerId } = normalizeScope(scope);
  const unique = [...new Set(garmentIds || [])];
  if (unique.length === 0) return;
  const { rows } = await db.query(
    `SELECT id FROM garments
     WHERE id = ANY($1::uuid[]) AND user_id = $2
       AND (status = 'active' OR suggested_by = $3)`,
    [unique, ownerId, viewerId]
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

const list = async (pool, scope, filters = {}) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const where = ['outfits.user_id = $2', "outfits.status = 'active'"];
  const params = [viewerId, ownerId];

  if (filters.rating) {
    params.push(filters.rating);
    where.push(`EXISTS (SELECT 1 FROM outfit_ratings r
      WHERE r.outfit_id = outfits.id AND r.user_id = $1 AND r.value = $${params.length})`);
  }

  const tagNames = (filters.tag || []).map((t) => t.toLowerCase());
  if (tagNames.length > 0) {
    params.push(tagNames);
    const idx = params.length;
    const joined = `outfit_tags ot JOIN tags t ON t.id = ot.tag_id
       WHERE ot.outfit_id = outfits.id AND t.user_id = $2
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
  return withMeta(pool, rows, { isOwner });
};

const getById = async (pool, scope, id) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const { rows } = await pool.query(
    `SELECT ${OUTFIT_SELECT} FROM outfits
     WHERE outfits.id = $3 AND outfits.user_id = $2
       AND (outfits.status = 'active' OR outfits.suggested_by = $1 OR $1 = $2)`,
    [viewerId, ownerId, id]
  );
  if (rows.length === 0) return null;
  const outfit = (await withMeta(pool, rows, { isOwner, withRatings: true }))[0];
  outfit.garments = await garmentService.listByIds(pool, { ownerId, viewerId }, outfit.garmentIds);
  return outfit;
};

const create = async (pool, scope, data) =>
  withTransaction(pool, async (client) => {
    const { ownerId, viewerId, isOwner } = normalizeScope(scope);
    await assertGarmentsUsable(client, { ownerId, viewerId }, data.garmentIds);
    const { rows } = await client.query(
      `INSERT INTO outfits (user_id, name, notes, status, suggested_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ownerId, data.name, data.notes ?? null, isOwner ? 'active' : 'suggested', isOwner ? null : viewerId]
    );
    const id = rows[0].id;
    await replaceGarments(client, id, data.garmentIds || []);
    if (data.rating != null) {
      await ratingService.setRating(client, { kind: 'outfit', itemId: id, viewerId, isOwner }, data.rating);
    }
    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, ownerId, data.tags);
      await tagService.replaceLinks(client, 'outfit', id, tagIds, viewerId);
    }
    return (await withMeta(client, [await selectById(client, viewerId, id)], { isOwner, withRatings: true }))[0];
  });

const update = async (pool, scope, id, data) =>
  withTransaction(pool, async (client) => {
    const { ownerId, viewerId, isOwner } = normalizeScope(scope);
    // Owner may edit anything; a visitor may edit only their own not-yet-accepted
    // suggested outfit.
    const owned = await client.query(
      `SELECT id FROM outfits
       WHERE id = $1 AND user_id = $2
         AND ($3 = $2 OR (status = 'suggested' AND suggested_by = $3))`,
      [id, ownerId, viewerId]
    );
    if (owned.rows.length === 0) return null;

    const sets = [];
    const params = [];
    const editable = isOwner ? ['name', 'notes'] : ['name'];
    for (const field of editable) {
      if (field in data) {
        params.push(data[field]);
        sets.push(`${field} = $${params.length}`);
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      params.push(id);
      await client.query(`UPDATE outfits SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }

    if ('rating' in data) {
      await ratingService.setRating(client, { kind: 'outfit', itemId: id, viewerId, isOwner }, data.rating);
    }

    if (data.garmentIds !== undefined) {
      await assertGarmentsUsable(client, { ownerId, viewerId }, data.garmentIds);
      await replaceGarments(client, id, data.garmentIds);
    }
    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, ownerId, data.tags || []);
      await tagService.replaceLinks(client, 'outfit', id, tagIds, viewerId);
    }

    return (await withMeta(client, [await selectById(client, viewerId, id)], { isOwner, withRatings: true }))[0];
  });

// Set/clear/upsert the viewer's rating of one visible outfit.
const setRatingById = async (pool, scope, id, value) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM outfits
       WHERE id = $1 AND user_id = $2 AND (status = 'active' OR suggested_by = $3 OR $3 = $2)`,
      [id, ownerId, viewerId]
    );
    if (rows.length === 0) return null;
    await ratingService.setRating(client, { kind: 'outfit', itemId: id, viewerId, isOwner }, value);
    const outfit = (await withMeta(client, [await selectById(client, viewerId, id)], { isOwner, withRatings: true }))[0];
    outfit.garments = await garmentService.listByIds(client, { ownerId, viewerId }, outfit.garmentIds);
    return outfit;
  });
};

// Record that the outfit was worn on `wornOn` (YYYY-MM-DD): one outfit_wears row
// plus one garment_wears row per garment currently in the outfit. Owner only.
const recordWear = async (pool, scope, id, wornOn) =>
  withTransaction(pool, async (client) => {
    const { ownerId, viewerId, isOwner } = normalizeScope(scope);
    if (!isOwner) return null;
    const owned = await client.query(
      "SELECT id FROM outfits WHERE id = $1 AND user_id = $2 AND status = 'active'",
      [id, ownerId]
    );
    if (owned.rows.length === 0) return null;

    await client.query(
      'INSERT INTO outfit_wears (outfit_id, user_id, worn_on) VALUES ($1, $2, $3)',
      [id, ownerId, wornOn]
    );
    await client.query(
      `INSERT INTO garment_wears (garment_id, user_id, worn_on, outfit_id)
       SELECT og.garment_id, $2, $3, $1 FROM outfit_garments og WHERE og.outfit_id = $1`,
      [id, ownerId, wornOn]
    );

    const outfit = (await withMeta(client, [await selectById(client, viewerId, id)], { isOwner: true, withRatings: true }))[0];
    outfit.garments = await garmentService.listByIds(client, { ownerId, viewerId }, outfit.garmentIds);
    return outfit;
  });

const setImage = async (pool, scope, id, img) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const { rowCount } = await pool.query(
    `UPDATE outfits SET
       image_key_prefix = $1, image_variants = $2, image_width = $3,
       image_height = $4, image_bytes = $5, image_hash = $6,
       image_updated_at = NOW(), updated_at = NOW()
     WHERE id = $7 AND user_id = $8`,
    [img.keyPrefix, JSON.stringify(img.variants), img.width, img.height, img.bytes, img.hash, id, ownerId]
  );
  if (rowCount === 0) return null;
  return getById(pool, { ownerId, viewerId }, id);
};

const clearImage = async (pool, scope, id) => {
  const { ownerId, viewerId } = normalizeScope(scope);
  const { rowCount } = await pool.query(
    `UPDATE outfits SET
       image_key_prefix = NULL, image_variants = NULL, image_width = NULL,
       image_height = NULL, image_bytes = NULL, image_hash = NULL,
       image_updated_at = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [id, ownerId]
  );
  if (rowCount === 0) return null;
  return getById(pool, { ownerId, viewerId }, id);
};

// Raw row (with image_* columns and user_id) for internal use by the image routes.
const getRow = async (pool, scope, id) => {
  const { ownerId } = normalizeScope(scope);
  const { rows } = await pool.query('SELECT * FROM outfits WHERE id = $1 AND user_id = $2', [id, ownerId]);
  return rows[0] || null;
};

const remove = async (pool, scope, id) => {
  const { ownerId } = normalizeScope(scope);
  const row = await getRow(pool, scope, id);
  if (!row) return false;
  await pool.query('DELETE FROM outfits WHERE id = $1 AND user_id = $2', [id, ownerId]);
  if (row.image_key_prefix) {
    await imageStore.delPrefix(row.image_key_prefix)
      .catch((err) => console.error('R2 cleanup after outfit delete failed:', err));
  }
  return true;
};

module.exports = {
  list, getById, getRow, create, update, setRatingById, recordWear,
  assertGarmentsUsable, setImage, clearImage, remove,
};
