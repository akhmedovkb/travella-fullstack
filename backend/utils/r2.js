//backend/utils/r2.js

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const bucket = process.env.R2_BUCKET;

const client = new S3Client({
  region: "auto",

  endpoint: process.env.R2_ENDPOINT,

  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadToR2({
  buffer,
  key,
  contentType,
}) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,

      Key: key,

      Body: buffer,

      ContentType: contentType,
    })
  );

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

module.exports = {
  uploadToR2,
};
