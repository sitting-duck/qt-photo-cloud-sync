const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, DeleteCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { response } = require("./response");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { id } = body;

    if (!id) {
      return response(400, { error: "Missing id" });
    }

    const existing = await ddb.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { id },
    }));

    if (!existing.Item) {
      return response(404, { error: "Photo not found" });
    }

    if (existing.Item.key) {
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: existing.Item.key,
      }));
    }

    await ddb.send(new DeleteCommand({
      TableName: process.env.TABLE_NAME,
      Key: { id },
    }));

    return response(200, { ok: true, deletedId: id });
  } catch (err) {
    console.error("delete-photo error", err);
    return response(500, { error: err.message || "Internal server error" });
  }
};

