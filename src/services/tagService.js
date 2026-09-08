// Free-form tags, scoped per user, unique case-insensitively. Tags are created
// implicitly when applied to a garment or outfit. See plan/outfitler_overview.md §2.
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

// Get-or-create one tag per name for this user; returns the unique tag ids.
const resolveTagIds = async (db, userId, names) => {
  const cleaned = [...new Set((names || []).map((n) => n.trim()).filter(Boolean))];
  const ids = [];
  for (const name of cleaned) {
    const { rows } = await db.query(
      `INSERT INTO tags (user_id, name) VALUES ($1, $2)
       ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [userId, name]
    );
    ids.push(rows[0].id);
  }
  return ids;
};

// Replace the entire tag set on one garment/outfit.
const replaceLinks = async (db, kind, ownerId, tagIds) => {
  const { table, column } = join(kind);
  await db.query(`DELETE FROM ${table} WHERE ${column} = $1`, [ownerId]);
  if (tagIds.length > 0) {
    await db.query(
      `INSERT INTO ${table} (${column}, tag_id) SELECT $1, unnest($2::uuid[])`,
      [ownerId, tagIds]
    );
  }
};

// Map of owner id -> tag names, for a set of garments/outfits (avoids N+1).
const namesByOwner = async (db, kind, ownerIds) => {
  const { table, column } = join(kind);
  const map = new Map(ownerIds.map((id) => [id, []]));
  if (ownerIds.length === 0) return map;
  const { rows } = await db.query(
    `SELECT j.${column} AS owner_id, t.name
     FROM ${table} j JOIN tags t ON t.id = j.tag_id
     WHERE j.${column} = ANY($1::uuid[])
     ORDER BY lower(t.name)`,
    [ownerIds]
  );
  for (const row of rows) {
    (map.get(row.owner_id) || []).push(row.name);
  }
  return map;
};

const listForUser = async (db, userId) => {
  const { rows } = await db.query(
    `SELECT t.id, t.name,
       (SELECT count(*)::int FROM garment_tags gt WHERE gt.tag_id = t.id) AS garment_count,
       (SELECT count(*)::int FROM outfit_tags ot WHERE ot.tag_id = t.id) AS outfit_count
     FROM tags t
     WHERE t.user_id = $1
     ORDER BY lower(t.name)`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    garmentCount: r.garment_count,
    outfitCount: r.outfit_count,
  }));
};

const remove = async (db, userId, tagId) => {
  const { rowCount } = await db.query(
    'DELETE FROM tags WHERE id = $1 AND user_id = $2',
    [tagId, userId]
  );
  return rowCount > 0;
};

module.exports = { resolveTagIds, replaceLinks, namesByOwner, listForUser, remove };
