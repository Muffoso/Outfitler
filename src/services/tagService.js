// Free-form tags, scoped per user, unique case-insensitively. Tags are created
// implicitly when applied to a garment or outfit. Friends visiting a wardrobe can
// add tags too: those resolve into the *owner's* namespace and carry an `added_by`
// attribution on the link row. See plan/outfitler_overview.md §2 and §9.
//
// `db` is a pg pool or a client inside a transaction. `kind` is 'garment' or
// 'outfit'; the table/column names it maps to are hard-coded literals, never
// user input.

const JOIN = {
  garment: { table: 'garment_tags', column: 'garment_id' },
  outfit: { table: 'outfit_tags', column: 'outfit_id' },
};

const join = (kind) => {
  const j = JOIN[kind];
  if (!j) throw new Error(`Unknown tag owner kind: ${kind}`);
  return j;
};

// Get-or-create one tag per name in `ownerId`'s namespace; returns the unique tag ids.
const resolveTagIds = async (db, ownerId, names) => {
  const cleaned = [...new Set((names || []).map((n) => n.trim()).filter(Boolean))];
  const ids = [];
  for (const name of cleaned) {
    const { rows } = await db.query(
      `INSERT INTO tags (user_id, name) VALUES ($1, $2)
       ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [ownerId, name]
    );
    ids.push(rows[0].id);
  }
  return ids;
};

// Reconcile the tag set on one garment/outfit to exactly `tagIds`. Diff-based so
// links that survive keep their original `added_by` (a full delete + reinsert
// would silently re-attribute every friend tag to whoever ran the edit).
const replaceLinks = async (db, kind, itemId, tagIds, addedBy = null) => {
  const { table, column } = join(kind);
  const { rows } = await db.query(`SELECT tag_id FROM ${table} WHERE ${column} = $1`, [itemId]);
  const current = new Set(rows.map((r) => r.tag_id));
  const target = new Set(tagIds);
  const toRemove = [...current].filter((id) => !target.has(id));
  const toAdd = [...target].filter((id) => !current.has(id));
  if (toRemove.length > 0) {
    await db.query(
      `DELETE FROM ${table} WHERE ${column} = $1 AND tag_id = ANY($2::uuid[])`,
      [itemId, toRemove]
    );
  }
  if (toAdd.length > 0) {
    await db.query(
      `INSERT INTO ${table} (${column}, tag_id, added_by) SELECT $1, unnest($2::uuid[]), $3
       ON CONFLICT (${column}, tag_id) DO NOTHING`,
      [itemId, toAdd, addedBy]
    );
  }
};

// Add one tag (by name) to an item without disturbing the others. Used by the
// visiting "add tag" endpoint and by the owner's add-tag form.
const addTag = async (db, { kind, itemId, ownerId, addedBy }, name) => {
  const { table, column } = join(kind);
  const [tagId] = await resolveTagIds(db, ownerId, [name]);
  if (!tagId) return;
  await db.query(
    `INSERT INTO ${table} (${column}, tag_id, added_by) VALUES ($1, $2, $3)
     ON CONFLICT (${column}, tag_id) DO NOTHING`,
    [itemId, tagId, addedBy ?? null]
  );
};

// Remove one tag (by name) from an item. A visitor (isOwner false) may only
// remove a link they added themselves; the owner may remove any.
const removeTag = async (db, { kind, itemId, ownerId, viewerId, isOwner }, name) => {
  const { table, column } = join(kind);
  const { rows } = await db.query(
    'SELECT id FROM tags WHERE user_id = $1 AND lower(name) = lower($2)',
    [ownerId, name]
  );
  if (rows.length === 0) return;
  const tagId = rows[0].id;
  const params = [itemId, tagId];
  let sql = `DELETE FROM ${table} WHERE ${column} = $1 AND tag_id = $2`;
  if (!isOwner) {
    params.push(viewerId);
    sql += ` AND added_by = $3`;
  }
  await db.query(sql, params);
  await pruneOrphans(db, ownerId);
};

// Map of item id -> tag names, for a set of garments/outfits (avoids N+1).
const namesByOwner = async (db, kind, itemIds) => {
  const { table, column } = join(kind);
  const map = new Map(itemIds.map((id) => [id, []]));
  if (itemIds.length === 0) return map;
  const { rows } = await db.query(
    `SELECT j.${column} AS item_id, t.name
     FROM ${table} j JOIN tags t ON t.id = j.tag_id
     WHERE j.${column} = ANY($1::uuid[])
     ORDER BY lower(t.name)`,
    [itemIds]
  );
  for (const row of rows) {
    (map.get(row.item_id) || []).push(row.name);
  }
  return map;
};

// Map of item id -> [{ name, addedBy, addedByName }], for detail views.
const attributionsByItem = async (db, kind, itemIds) => {
  const { table, column } = join(kind);
  const map = new Map(itemIds.map((id) => [id, []]));
  if (itemIds.length === 0) return map;
  const { rows } = await db.query(
    `SELECT j.${column} AS item_id, t.name, j.added_by,
            COALESCE(u.display_name, split_part(u.email, '@', 1)) AS added_by_name
     FROM ${table} j
     JOIN tags t ON t.id = j.tag_id
     LEFT JOIN users u ON u.id = j.added_by
     WHERE j.${column} = ANY($1::uuid[])
     ORDER BY lower(t.name)`,
    [itemIds]
  );
  for (const row of rows) {
    (map.get(row.item_id) || []).push({
      name: row.name,
      addedBy: row.added_by || null,
      addedByName: row.added_by ? row.added_by_name : null,
    });
  }
  return map;
};

// Delete tags that are no longer linked to any garment or outfit.
const pruneOrphans = async (db, ownerId) => {
  await db.query(
    `DELETE FROM tags
     WHERE user_id = $1
       AND NOT EXISTS (SELECT 1 FROM garment_tags gt WHERE gt.tag_id = tags.id)
       AND NOT EXISTS (SELECT 1 FROM outfit_tags ot WHERE ot.tag_id = tags.id)`,
    [ownerId]
  );
};

const listRows = async (db, ownerId) => {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.created_at,
       (SELECT count(*)::int FROM garment_tags gt WHERE gt.tag_id = t.id) AS garment_count,
       (SELECT count(*)::int FROM outfit_tags ot WHERE ot.tag_id = t.id) AS outfit_count
     FROM tags t
     WHERE t.user_id = $1
     ORDER BY lower(t.name)`,
    [ownerId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    garmentCount: r.garment_count,
    outfitCount: r.outfit_count,
  }));
};

// The owner listing their own tags — prunes orphans first.
const listForOwner = async (db, ownerId) => {
  await pruneOrphans(db, ownerId);
  return listRows(db, ownerId);
};

// A visitor listing a friend's tags — never mutates the friend's data.
const listVisible = async (db, ownerId) => listRows(db, ownerId);

const remove = async (db, ownerId, tagId) => {
  const { rowCount } = await db.query(
    'DELETE FROM tags WHERE id = $1 AND user_id = $2',
    [tagId, ownerId]
  );
  return rowCount > 0;
};

module.exports = {
  resolveTagIds,
  replaceLinks,
  addTag,
  removeTag,
  namesByOwner,
  attributionsByItem,
  listForOwner,
  listVisible,
  pruneOrphans,
  remove,
};
