// Friends: mutual, confirmed. A invites B by email; B accepts; then either may
// visit the other's wardrobe. An invite to an address with no account waits in
// friend_invites and becomes a pending request when that address signs in.
// See plan/outfitler_overview.md §9.
//
// `db` is a pg pool or a client inside a transaction.

const crypto = require('crypto');
const emailService = require('./emailService');

const PENDING_CAP = 20; // combined outgoing pending requests + email invites per user
const UNIQUE_VIOLATION = '23505';

const norm = (email) => email.toLowerCase().trim();

const displayNameSql = "COALESCE(u.display_name, split_part(u.email, '@', 1))";

const findUserByEmail = async (db, email) => {
  const { rows } = await db.query('SELECT id, email FROM users WHERE email = $1', [norm(email)]);
  return rows[0] || null;
};

const pairFilter = '(LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid) '
  + 'AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid))';

const getFriendship = async (db, a, b) => {
  const { rows } = await db.query(`SELECT * FROM friendships WHERE ${pairFilter}`, [a, b]);
  return rows[0] || null;
};

const areFriends = async (db, a, b) => {
  const { rows } = await db.query(
    'SELECT 1 FROM accepted_friends WHERE user_id = $1 AND friend_id = $2 LIMIT 1',
    [a, b]
  );
  return rows.length > 0;
};

const countPendingOutgoing = async (db, userId) => {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM friendships WHERE requester_id = $1 AND status = 'pending')
     + (SELECT count(*) FROM friend_invites WHERE requester_id = $1) AS n`,
    [userId]
  );
  return Number(rows[0].n);
};

const countIncomingRequests = async (db, userId) => {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM friendships WHERE addressee_id = $1 AND status = 'pending'",
    [userId]
  );
  return rows[0].n;
};

const acceptRow = async (db, id) => {
  await db.query(
    "UPDATE friendships SET status = 'accepted', responded_at = NOW() WHERE id = $1",
    [id]
  );
};

// Invite by email. Returns { status: 'accepted' | 'pending' | 'invited' }.
const invite = async (pool, me, myEmail, rawEmail) => {
  const email = norm(rawEmail);
  if (email === norm(myEmail)) {
    const err = new Error('You cannot add yourself');
    err.code = 'SELF';
    throw err;
  }

  const target = await findUserByEmail(pool, email);

  if (target) {
    const existing = await getFriendship(pool, me, target.id);
    if (existing) {
      if (existing.status === 'accepted') {
        const err = new Error('Already friends');
        err.code = 'ALREADY_FRIENDS';
        throw err;
      }
      if (existing.addressee_id === me) {
        await acceptRow(pool, existing.id);
        return { status: 'accepted' };
      }
      return { status: 'pending' };
    }

    if (await countPendingOutgoing(pool, me) >= PENDING_CAP) {
      const err = new Error('Too many pending invites');
      err.code = 'CAP';
      throw err;
    }

    try {
      await pool.query(
        "INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')",
        [me, target.id]
      );
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      // Someone invited in the other direction in the meantime.
      const now = await getFriendship(pool, me, target.id);
      if (now && now.status === 'pending' && now.addressee_id === me) {
        await acceptRow(pool, now.id);
        return { status: 'accepted' };
      }
      return { status: 'pending' };
    }

    emailService.sendFriendRequestEmail(target.email, myEmail).catch((e) =>
      console.error('Friend request email failed:', e));
    return { status: 'pending' };
  }

  // No account yet — store a pending invite keyed on the email.
  if (await countPendingOutgoing(pool, me) >= PENDING_CAP) {
    const err = new Error('Too many pending invites');
    err.code = 'CAP';
    throw err;
  }
  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO friend_invites (requester_id, email, token) VALUES ($1, $2, $3)
     ON CONFLICT (requester_id, email) DO UPDATE SET created_at = NOW(), token = EXCLUDED.token
     RETURNING token`,
    [me, email, token]
  );
  emailService.sendFriendInviteEmail(email, myEmail, rows[0].token).catch((e) =>
    console.error('Friend invite email failed:', e));
  return { status: 'invited' };
};

const list = async (pool, me) => {
  const [friends, incoming, outgoing, invites] = await Promise.all([
    pool.query(
      `SELECT u.id AS "userId", ${displayNameSql} AS "displayName", u.email, af.created_at AS since
       FROM accepted_friends af JOIN users u ON u.id = af.friend_id
       WHERE af.user_id = $1 ORDER BY "displayName"`,
      [me]
    ),
    pool.query(
      `SELECT f.id AS "requestId", u.id AS "fromUserId", ${displayNameSql} AS "displayName",
              u.email, f.created_at AS "createdAt"
       FROM friendships f JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending' ORDER BY f.created_at DESC`,
      [me]
    ),
    pool.query(
      `SELECT f.id AS "requestId", u.id AS "toUserId", ${displayNameSql} AS "displayName",
              u.email, f.created_at AS "createdAt"
       FROM friendships f JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1 AND f.status = 'pending' ORDER BY f.created_at DESC`,
      [me]
    ),
    pool.query(
      `SELECT id AS "inviteId", email, created_at AS "createdAt"
       FROM friend_invites WHERE requester_id = $1 ORDER BY created_at DESC`,
      [me]
    ),
  ]);
  return {
    friends: friends.rows,
    incoming: incoming.rows,
    outgoing: outgoing.rows,
    invites: invites.rows,
  };
};

const accept = async (pool, me, requestId) => {
  const { rows } = await pool.query(
    `UPDATE friendships SET status = 'accepted', responded_at = NOW()
     WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
     RETURNING requester_id`,
    [requestId, me]
  );
  if (rows.length === 0) return null;
  const { rows: u } = await pool.query(
    `SELECT id AS "userId", ${displayNameSql} AS "displayName" FROM users u WHERE id = $1`,
    [rows[0].requester_id]
  );
  return u[0];
};

const decline = async (pool, me, requestId) => {
  const { rowCount } = await pool.query(
    "DELETE FROM friendships WHERE id = $1 AND addressee_id = $2 AND status = 'pending'",
    [requestId, me]
  );
  return rowCount > 0;
};

const cancel = async (pool, me, requestId) => {
  const { rowCount } = await pool.query(
    "DELETE FROM friendships WHERE id = $1 AND requester_id = $2 AND status = 'pending'",
    [requestId, me]
  );
  return rowCount > 0;
};

const cancelInvite = async (pool, me, inviteId) => {
  const { rowCount } = await pool.query(
    'DELETE FROM friend_invites WHERE id = $1 AND requester_id = $2',
    [inviteId, me]
  );
  return rowCount > 0;
};

const removeFriend = async (pool, me, otherId) => {
  const { rowCount } = await pool.query(
    `DELETE FROM friendships WHERE status = 'accepted' AND ${pairFilter}`,
    [me, otherId]
  );
  return rowCount > 0;
};

// On sign-in: turn any pending email invites for this address into pending
// friend requests the new user can accept.
const consumeInvites = async (db, userId, email) => {
  const { rows } = await db.query(
    'DELETE FROM friend_invites WHERE email = $1 RETURNING requester_id',
    [norm(email)]
  );
  for (const { requester_id } of rows) {
    if (requester_id === userId) continue;
    await db.query(
      `INSERT INTO friendships (requester_id, addressee_id, status)
       SELECT $1, $2, 'pending'
       WHERE NOT EXISTS (SELECT 1 FROM friendships WHERE ${pairFilter})`,
      [requester_id, userId]
    );
  }
};

module.exports = {
  areFriends,
  countIncomingRequests,
  invite,
  list,
  accept,
  decline,
  cancel,
  cancelInvite,
  removeFriend,
  consumeInvites,
};
