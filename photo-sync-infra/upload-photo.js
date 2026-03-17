const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = "us-east-1";
const BUCKET_NAME = "photosyncinfrastack-photobucket465738b3-ug7z83mjp8cx";
const TABLE_NAME = "PhotoSyncInfraStack-PhotoTable2B3A6C45-1RYSICT0BU8N5";
const PROFILE = "qt-photo-sync";

process.env.AWS_PROFILE = PROFILE;

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function uploadPhoto(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const photoId = crypto.randomUUID();
  const s3Key = `uploads/${photoId}-${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileBuffer,
    })
  );

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        photoId,
        fileName,
        s3Key,
        uploadedAt: new Date().toISOString(),
      },
    })
  );

  return { photoId, fileName, s3Key };
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: node upload-photo.js <path-to-file>");
    process.exit(1);
  }

  try {
    const result = await uploadPhoto(filePath);
    console.log("Upload successful:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Upload failed:");
    console.error(err);
    process.exit(1);
  }
}

main();

