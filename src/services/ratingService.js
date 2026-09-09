// Per-user ratings for garments and outfits (1-10). Everyone who can see an item
// (owner + accepted friends) may rate it. The owner's own rating is mirrored to
// garments.rating / outfits.rating while that column still exists.
//
// `db` is a pg pool or a client inside a transaction. `kind` is 'garment' or
// 'outfit'; table names it maps to are hard-coded literals, never user input.

const TABLES = {
  garment: { ratings: 'garment_ratings', col: 'garment_id', mirror: 'garments' },
  outfit: { ratings: 'outfit_ratings', col: 'outfit_id', mirror: 'outfits' },
};

const table = (kind) => {
  const t = TABLES[kind];
  if (!t) throw new Error(`Unknown rating kind: ${kind}`);
  return t;
};

// Upsert (or, for value == null, delete) the viewer's rating of one item.
const setRating = async (db, { kind, itemId, viewerId, isOwner }, value) => {
  const t = table(kind);
  if (value == null) {
    await db.query(`DELETE FROM ${t.ratings} WHERE ${t.col} = $1 AND user_id = $2`, [itemId, viewerId]);
  } else {
    await db.query(
      `INSERT INTO ${t.ratings} (${t.col}, user_id, value) VALUES ($1, $2, $3)
       ON CONFLICT (${t.col}, user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [itemId, viewerId, value]
    );
  }
  if (isOwner) {
    // Transitional mirror; removed with the garments.rating / outfits.rating column.
    await db.query(`UPDATE ${t.mirror} SET rating = $1, updated_at = NOW() WHERE id = $2`, [value ?? null, itemId]);
  }
};

// Map of item id -> [{ userId, displayName, value }], highest first. For detail views.
const peopleByItem = async (db, kind, itemIds) => {
  const t = table(kind);
  const map = new Map((itemIds || []).map((id) => [id, []]));
  if (!itemIds || itemIds.length === 0) return map;
  const { rows } = await db.query(
    `SELECT r.${t.col} AS item_id, r.user_id, r.value,
            COALESCE(u.display_name, split_part(u.email, '@', 1)) AS display_name
     FROM ${t.ratings} r JOIN users u ON u.id = r.user_id
     WHERE r.${t.col} = ANY($1::uuid[])
     ORDER BY r.value DESC, display_name`,
    [itemIds]
  );
  for (const row of rows) {
    (map.get(row.item_id) || []).push({
      userId: row.user_id,
      displayName: row.display_name,
      value: row.value,
    });
  }
  return map;
};

module.exports = { setRating, peopleByItem };
