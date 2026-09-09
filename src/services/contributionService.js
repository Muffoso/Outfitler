// What a friend has contributed to *your* wardrobe: garments/outfits they
// suggested, ratings they gave your items, and notes they edited. See
// plan/outfitler_overview.md §9.

const { buildImage } = require('./imageUrls');

const image = (row) => buildImage(row);

const from = async (pool, viewerId, friendId) => {
  const [nameRes, sg, so, gr, or_, gn, on_] = await Promise.all([
    pool.query(
      "SELECT COALESCE(display_name, split_part(email, '@', 1)) AS name FROM users WHERE id = $1",
      [friendId]
    ),
    pool.query(
      `SELECT * FROM garments
       WHERE user_id = $1 AND status = 'suggested' AND suggested_by = $2
       ORDER BY created_at DESC`,
      [viewerId, friendId]
    ),
    pool.query(
      `SELECT * FROM outfits
       WHERE user_id = $1 AND status = 'suggested' AND suggested_by = $2
       ORDER BY created_at DESC`,
      [viewerId, friendId]
    ),
    pool.query(
      `SELECT g.*, r.value AS r_value, r.updated_at AS r_at
       FROM garment_ratings r JOIN garments g ON g.id = r.garment_id
       WHERE g.user_id = $1 AND r.user_id = $2 AND r.user_id <> g.user_id AND g.status = 'active'
       ORDER BY r.updated_at DESC`,
      [viewerId, friendId]
    ),
    pool.query(
      `SELECT o.*, r.value AS r_value, r.updated_at AS r_at
       FROM outfit_ratings r JOIN outfits o ON o.id = r.outfit_id
       WHERE o.user_id = $1 AND r.user_id = $2 AND r.user_id <> o.user_id AND o.status = 'active'
       ORDER BY r.updated_at DESC`,
      [viewerId, friendId]
    ),
    pool.query(
      `SELECT * FROM garments
       WHERE user_id = $1 AND notes_updated_by = $2 AND notes_updated_by <> user_id
         AND status = 'active' AND notes IS NOT NULL
       ORDER BY notes_updated_at DESC`,
      [viewerId, friendId]
    ),
    pool.query(
      `SELECT * FROM outfits
       WHERE user_id = $1 AND notes_updated_by = $2 AND notes_updated_by <> user_id
         AND status = 'active' AND notes IS NOT NULL
       ORDER BY notes_updated_at DESC`,
      [viewerId, friendId]
    ),
  ]);

  const suggestedGarments = await Promise.all(sg.rows.map(async (r) => ({
    id: r.id, image: await image(r), createdAt: r.created_at,
  })));
  const suggestedOutfits = await Promise.all(so.rows.map(async (r) => ({
    id: r.id, name: r.name, image: await image(r), createdAt: r.created_at,
  })));

  const ratings = (await Promise.all([
    ...gr.rows.map(async (r) => ({
      kind: 'garment', id: r.id, name: null, image: await image(r), value: r.r_value, at: r.r_at,
    })),
    ...or_.rows.map(async (r) => ({
      kind: 'outfit', id: r.id, name: r.name, image: await image(r), value: r.r_value, at: r.r_at,
    })),
  ])).sort((a, b) => new Date(b.at) - new Date(a.at));

  const notes = (await Promise.all([
    ...gn.rows.map(async (r) => ({
      kind: 'garment', id: r.id, name: null, image: await image(r), notes: r.notes, at: r.notes_updated_at,
    })),
    ...on_.rows.map(async (r) => ({
      kind: 'outfit', id: r.id, name: r.name, image: await image(r), notes: r.notes, at: r.notes_updated_at,
    })),
  ])).sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    friendName: nameRes.rows[0] ? nameRes.rows[0].name : 'en vän',
    suggestedGarments,
    suggestedOutfits,
    ratings,
    notes,
  };
};

// Map friendId -> ISO timestamp of their most recent contribution to viewerId.
const lastActivityByFriend = async (pool, viewerId) => {
  const { rows } = await pool.query(
    `SELECT f AS friend_id, max(ts) AS last_at FROM (
       SELECT suggested_by AS f, created_at AS ts FROM garments WHERE user_id = $1 AND suggested_by IS NOT NULL
       UNION ALL SELECT suggested_by, created_at FROM outfits WHERE user_id = $1 AND suggested_by IS NOT NULL
       UNION ALL SELECT r.user_id, r.updated_at FROM garment_ratings r JOIN garments g ON g.id = r.garment_id
         WHERE g.user_id = $1 AND r.user_id <> g.user_id
       UNION ALL SELECT r.user_id, r.updated_at FROM outfit_ratings r JOIN outfits o ON o.id = r.outfit_id
         WHERE o.user_id = $1 AND r.user_id <> o.user_id
       UNION ALL SELECT notes_updated_by, notes_updated_at FROM garments
         WHERE user_id = $1 AND notes_updated_by IS NOT NULL AND notes_updated_by <> user_id
       UNION ALL SELECT notes_updated_by, notes_updated_at FROM outfits
         WHERE user_id = $1 AND notes_updated_by IS NOT NULL AND notes_updated_by <> user_id
     ) x
     WHERE f IS NOT NULL AND ts IS NOT NULL
     GROUP BY f`,
    [viewerId]
  );
  const map = {};
  for (const r of rows) map[r.friend_id] = r.last_at;
  return map;
};

module.exports = { from, lastActivityByFriend };
