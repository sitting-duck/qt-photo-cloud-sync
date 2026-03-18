const {
  ddb,
  TABLE_NAME,
  PutCommand,
} = require("./shared/aws");
const { json } = require("./shared/response");

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { photoId, fileName, s3Key, contentType, sizeBytes, fileHash } = body;

    if (!photoId || !fileName || !s3Key || !fileHash) {
      return json(400, { error: "Missing required fields" });
    }

    const item = {
      photoId,
      fileName,
      s3Key,
      uploadedAt: new Date().toISOString(),
      contentType,
      sizeBytes,
      fileHash,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    return json(200, {
      message: "Metadata saved",
      duplicate: false,
      photo: item,
    });
  } catch (error) {
    console.error("upload-complete error", error);
    return json(500, { error: "Failed to save metadata" });
  }
};

