const crypto = require("crypto");
const {
  s3,
  ddb,
  BUCKET_NAME,
  TABLE_NAME,
  PutObjectCommand,
  QueryCommand,
  getSignedUrl,
} = require("./shared/aws");
const { json } = require("./shared/response");

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { fileName, contentType, fileHash, sizeBytes } = body;

    if (!fileName || !fileHash) {
      return json(400, { error: "fileName and fileHash required" });
    }

    const existing = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "fileHash-index",
        KeyConditionExpression: "fileHash = :hash",
        ExpressionAttributeValues: {
          ":hash": fileHash,
        },
        Limit: 1,
      })
    );

    if (existing.Items && existing.Items.length > 0) {
      return json(200, {
        duplicate: true,
        message: "Duplicate file already uploaded",
        photo: existing.Items[0],
      });
    }

    const photoId = crypto.randomUUID();
    const s3Key = `uploads/${photoId}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType || "application/octet-stream",
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return json(200, {
      duplicate: false,
      uploadUrl,
      photoId,
      s3Key,
      fileHash,
      sizeBytes,
    });
  } catch (error) {
    console.error("upload-url error", error);
    return json(500, { error: "Failed to create upload URL" });
  }
};

