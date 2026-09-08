// Cloudflare R2 driver for the image store. Private bucket, S3-compatible API.
// See plan/image_storage.md.

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../../config');

const client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

const BUCKET = config.r2.bucket;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MAX_TTL = 604800; // 7 days — SigV4 presigned-URL maximum

// Store one object. Objects are content-addressed by a random imageId in the
// key, so they are safe to cache immutably.
const put = (key, body, contentType) =>
  client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: IMMUTABLE,
  }));

// A time-limited GET URL for a private object.
const signedUrl = (key, ttlSeconds = MAX_TTL) =>
  getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: Math.min(Math.max(ttlSeconds, 1), MAX_TTL),
  });

// Delete a list of keys (DeleteObjects caps at 1000 per call).
const del = async (keys) => {
  if (!keys || keys.length === 0) return;
  for (let i = 0; i < keys.length; i += 1000) {
    await client.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })),
        Quiet: true,
      },
    }));
  }
};

// Delete everything under a key prefix (used to drop a garment's old image).
// Returns the number of objects removed.
const delPrefix = async (prefix) => {
  const keys = [];
  let ContinuationToken;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken,
    }));
    for (const obj of res.Contents || []) keys.push(obj.Key);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  await del(keys);
  return keys.length;
};

module.exports = { put, signedUrl, del, delPrefix };
