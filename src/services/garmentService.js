// A garment is a photo (max one) with ratings, free-text notes and tags. Reads
// are scoped: `scope` is either a bare userId string (owner === viewer) or
// { ownerId, viewerId } for a friend visiting the owner's wardrobe. Write paths
// (update/setImage/clearImage/addWear/remove) stay owner-only. See
// plan/outfitler_overview.md §2, §9 and plan/image_storage.md.

const withTransaction = require('../db/withTransaction');
const tagService = require('./tagService');
const ratingService = require('./ratingService');
const imageStore = require('./imageStore');
const { buildImage } = require('./imageUrls');
const { normalizeScope } = require('./scope');

// garments.* plus derived wear stats and rating aggregates. $1 is always viewerId.
const GARMENT_SELECT = `garments.*,
  (SELECT count(*)::int FROM garment_wears w WHERE w.garment_id = garments.id) AS wear_count,
  (SELECT to_char(max(w.worn_on), 'YYYY-MM-DD') FROM garment_wears w WHERE w.garment_id = garments.id) AS last_worn_on,
  (SELECT round(avg(value)::numeric, 2) FROM garment_ratings r WHERE r.garment_id = garments.id) AS avg_rating,
  (SELECT count(*)::int FROM garment_ratings r WHERE r.garment_id = garments.id) AS rating_count,
  (SELECT value FROM garment_ratings r WHERE r.garment_id = garments.id AND r.user_id = $1) AS viewer_rating`;

const ORDER = {
  rating: 'viewer_rating DESC NULLS LAST, garments.created_at DESC',
  avg_rating: 'avg_rating DESC NULLS LAST, rating_count DESC, garments.created_at DESC',
  most_worn: 'wear_count DESC, garments.created_at DESC',
  last_worn: 'last_worn_on DESC NULLS LAST, garments.created_at DESC',
  created: 'garments.created_at DESC',
};

const serialize = async (row, tags, ratings, isOwner) => ({
  id: row.id,
  rating: row.viewer_rating ?? null,
  myRating: row.viewer_rating ?? null,
  avgRating: row.avg_rating != null ? Number(row.avg_rating) : null,
  ratingCount: row.rating_count ?? 0,
  ratings: ratings || [],
  notes: isOwner ? row.notes : undefined,
  archived: row.archived,
  image: await buildImage(row),
  tags: tags || [],
  status: row.status,
  suggestedBy: row.suggested_by || null,
  wearCount: row.wear_count ?? 0,
  lastWornOn: row.last_worn_on || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const hydrate = async (db, rows, opts = {}) => {
  const { isOwner = true, withRatings = false } = opts;
  const ids = rows.map((r) => r.id);
  const [tagMap, ratingMap] = await Promise.all([
    tagService.namesByOwner(db, 'garment', ids),
    withRatings ? ratingService.peopleByItem(db, 'garment', ids) : Promise.resolve(new Map()),
  ]);
  return Promise.all(rows.map((r) => serialize(r, tagMap.get(r.id), ratingMap.get(r.id), isOwner)));
};

const selectById = async (db, viewerId, id) => {
  const { rows } = await db.query(`SELECT ${GARMENT_SELECT} FROM garments WHERE garments.id = $2`, [viewerId, id]);
  return rows[0] || null;
};

const list = async (pool, scope, filters = {}) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const where = ['garments.user_id = $2', isOwner
    ? "garments.status = 'active'"
    : "(garments.status = 'active' OR (garments.status = 'suggested' AND garments.suggested_by = $1))"];
  const params = [viewerId, ownerId];

  const archived = filters.archived || 'false';
  if (archived === 'true') where.push('garments.archived = true');
  else if (archived !== 'all') where.push('garments.archived = false');

  if (filters.rating) {
    params.push(filters.rating);
    where.push(`EXISTS (SELECT 1 FROM garment_ratings r
      WHERE r.garment_id = garments.id AND r.user_id = $1 AND r.value = $${params.length})`);
  }

  const tagNames = (filters.tag || []).map((t) => t.toLowerCase());
  if (tagNames.length > 0) {
    params.push(tagNames);
    const idx = params.length;
    const joined = `garment_tags gt JOIN tags t ON t.id = gt.tag_id
       WHERE gt.garment_id = garments.id AND t.user_id = $2
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
  return hydrate(pool, rows, { isOwner });
};

// Full serialized garments for a set of ids, scoped like getById. Preserves the
// caller's id order.
const listByIds = async (pool, scope, ids) => {
  if (!ids || ids.length === 0) return [];
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const { rows } = await pool.query(
    `SELECT ${GARMENT_SELECT} FROM garments
     WHERE garments.id = ANY($3::uuid[]) AND garments.user_id = $2
       AND (garments.status = 'active' OR garments.suggested_by = $1 OR $1 = $2)`,
    [viewerId, ownerId, ids]
  );
  const serialized = await hydrate(pool, rows, { isOwner });
  const byId = new Map(serialized.map((g) => [g.id, g]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

// Raw row (with image_* columns and user_id) for internal use by the image routes.
const getRow = async (pool, scope, id) => {
  const { ownerId } = normalizeScope(scope);
  const { rows } = await pool.query('SELECT * FROM garments WHERE id = $1 AND user_id = $2', [id, ownerId]);
  return rows[0] || null;
};

const getById = async (pool, scope, id) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const { rows } = await pool.query(
    `SELECT ${GARMENT_SELECT} FROM garments
     WHERE garments.id = $3 AND garments.user_id = $2
       AND (garments.status = 'active' OR garments.suggested_by = $1 OR $1 = $2)`,
    [viewerId, ownerId, id]
  );
  if (rows.length === 0) return null;
  return (await hydrate(pool, rows, { isOwner, withRatings: true }))[0];
};

const create = async (pool, scope, data) =>
  withTransaction(pool, async (client) => {
    const { ownerId, viewerId, isOwner } = normalizeScope(scope);
    const { rows } = await client.query(
      `INSERT INTO garments (user_id, notes, status, suggested_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ownerId, data.notes ?? null, isOwner ? 'active' : 'suggested', isOwner ? null : viewerId]
    );
    const id = rows[0].id;
    if (data.rating != null) {
      await ratingService.setRating(client, { kind: 'garment', itemId: id, viewerId, isOwner }, data.rating);
    }
    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, ownerId, data.tags);
      await tagService.replaceLinks(client, 'garment', id, tagIds, viewerId);
    }
    return (await hydrate(client, [await selectById(client, viewerId, id)], { isOwner, withRatings: true }))[0];
  });

const update = async (pool, scope, id, data) =>
  withTransaction(pool, async (client) => {
    const { ownerId, viewerId, isOwner } = normalizeScope(scope);
    if (!isOwner) return null;
    const owned = await client.query('SELECT id FROM garments WHERE id = $1 AND user_id = $2', [id, ownerId]);
    if (owned.rows.length === 0) return null;

    const sets = [];
    const params = [];
    for (const field of ['notes', 'archived']) {
      if (field in data) {
        params.push(data[field]);
        sets.push(`${field} = $${params.length}`);
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      params.push(id);
      await client.query(`UPDATE garments SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }

    if ('rating' in data) {
      await ratingService.setRating(client, { kind: 'garment', itemId: id, viewerId, isOwner }, data.rating);
    }

    if (data.tags !== undefined) {
      const tagIds = await tagService.resolveTagIds(client, ownerId, data.tags || []);
      await tagService.replaceLinks(client, 'garment', id, tagIds, viewerId);
    }

    return (await hydrate(client, [await selectById(client, viewerId, id)], { isOwner: true, withRatings: true }))[0];
  });

// Set/clear/upsert the viewer's rating of one visible garment. Returns the
// re-serialized garment, or null if not visible.
const setRatingById = async (pool, scope, id, value) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM garments
       WHERE id = $1 AND user_id = $2 AND (status = 'active' OR suggested_by = $3 OR $3 = $2)`,
      [id, ownerId, viewerId]
    );
    if (rows.length === 0) return null;
    await ratingService.setRating(client, { kind: 'garment', itemId: id, viewerId, isOwner }, value);
    return (await hydrate(client, [await selectById(client, viewerId, id)], { isOwner, withRatings: true }))[0];
  });
};

const isVisible = async (db, { ownerId, viewerId }, id) => {
  const { rows } = await db.query(
    `SELECT id FROM garments
     WHERE id = $1 AND user_id = $2 AND (status = 'active' OR suggested_by = $3 OR $3 = $2)`,
    [id, ownerId, viewerId]
  );
  return rows.length > 0;
};

// Add one tag to a visible garment (owner or visiting friend). Returns the
// re-serialized garment, or null if not visible.
const addTagById = async (pool, scope, id, name) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  return withTransaction(pool, async (client) => {
    if (!(await isVisible(client, { ownerId, viewerId }, id))) return null;
    await tagService.addTag(client, { kind: 'garment', itemId: id, ownerId, addedBy: viewerId }, name);
    return (await hydrate(client, [await selectById(client, viewerId, id)], { isOwner, withRatings: true }))[0];
  });
};

// Remove one tag. A visitor may only remove a link they added themselves.
const removeTagById = async (pool, scope, id, name) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  return withTransaction(pool, async (client) => {
    if (!(await isVisible(client, { ownerId, viewerId }, id))) return null;
    await tagService.removeTag(client, { kind: 'garment', itemId: id, ownerId, viewerId, isOwner }, name);
    return (await hydrate(client, [await selectById(client, viewerId, id)], { isOwner, withRatings: true }))[0];
  });
};

// Owner accepts a friend's suggested garment: it becomes a normal garment.
const acceptSuggestion = async (pool, ownerId, id) => {
  const { rowCount } = await pool.query(
    `UPDATE garments SET status = 'active', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'suggested'`,
    [id, ownerId]
  );
  if (rowCount === 0) return null;
  return getById(pool, ownerId, id);
};

// Owner ignores a suggested garment: delete it (and its image objects).
const ignoreSuggestion = async (pool, ownerId, id) => {
  const { rows } = await pool.query(
    "SELECT image_key_prefix FROM garments WHERE id = $1 AND user_id = $2 AND status = 'suggested'",
    [id, ownerId]
  );
  if (rows.length === 0) return false;
  await pool.query('DELETE FROM garments WHERE id = $1 AND user_id = $2', [id, ownerId]);
  if (rows[0].image_key_prefix) {
    await imageStore.delPrefix(rows[0].image_key_prefix)
      .catch((err) => console.error('R2 cleanup after suggestion ignore failed:', err));
  }
  return true;
};

// Suggested garments in the owner's wardrobe, with who suggested them.
const listSuggestions = async (pool, ownerId) => {
  const { rows } = await pool.query(
    `SELECT ${GARMENT_SELECT},
       (SELECT COALESCE(u.display_name, split_part(u.email, '@', 1))
        FROM users u WHERE u.id = garments.suggested_by) AS suggested_by_name
     FROM garments
     WHERE garments.user_id = $1 AND garments.status = 'suggested'
     ORDER BY garments.created_at DESC`,
    [ownerId]
  );
  const serialized = await hydrate(pool, rows, { isOwner: true });
  return serialized.map((g, i) => ({
    ...g,
    suggestedBy: rows[i].suggested_by
      ? { userId: rows[i].suggested_by, displayName: rows[i].suggested_by_name }
      : null,
  }));
};

const setImage = async (pool, scope, id, img) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const { rowCount } = await pool.query(
    `UPDATE garments SET
       image_key_prefix = $1, image_variants = $2, image_width = $3,
       image_height = $4, image_bytes = $5, image_hash = $6,
       image_updated_at = NOW(), updated_at = NOW()
     WHERE id = $7 AND user_id = $8`,
    [img.keyPrefix, JSON.stringify(img.variants), img.width, img.height, img.bytes, img.hash, id, ownerId]
  );
  if (rowCount === 0) return null;
  return (await hydrate(pool, [await selectById(pool, viewerId, id)], { isOwner, withRatings: true }))[0];
};

const clearImage = async (pool, scope, id) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const { rowCount } = await pool.query(
    `UPDATE garments SET
       image_key_prefix = NULL, image_variants = NULL, image_width = NULL,
       image_height = NULL, image_bytes = NULL, image_hash = NULL,
       image_updated_at = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [id, ownerId]
  );
  if (rowCount === 0) return null;
  return (await hydrate(pool, [await selectById(pool, viewerId, id)], { isOwner, withRatings: true }))[0];
};

// Record that the garment was worn on `wornOn` (YYYY-MM-DD). Owner only.
const addWear = async (pool, scope, id, wornOn) => {
  const { ownerId, isOwner } = normalizeScope(scope);
  if (!isOwner) return null;
  const { rowCount } = await pool.query(
    `INSERT INTO garment_wears (garment_id, user_id, worn_on)
     SELECT id, $2, $3 FROM garments WHERE id = $1 AND user_id = $2`,
    [id, ownerId, wornOn]
  );
  if (rowCount === 0) return null;
  return getById(pool, scope, id);
};

const remove = async (pool, scope, id) => {
  const { ownerId, viewerId, isOwner } = normalizeScope(scope);
  const row = await getRow(pool, scope, id);
  if (!row) return false;
  // A visitor may only withdraw their own not-yet-accepted suggestion.
  if (!isOwner && !(row.status === 'suggested' && row.suggested_by === viewerId)) return false;
  await pool.query('DELETE FROM garments WHERE id = $1 AND user_id = $2', [id, ownerId]);
  if (row.image_key_prefix) {
    await imageStore.delPrefix(row.image_key_prefix)
      .catch((err) => console.error('R2 cleanup after garment delete failed:', err));
  }
  return true;
};

module.exports = {
  list, listByIds, getRow, getById, create, update, setRatingById,
  addTagById, removeTagById, acceptSuggestion, ignoreSuggestion, listSuggestions,
  setImage, clearImage, addWear, remove,
};
