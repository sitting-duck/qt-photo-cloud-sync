const {
  s3,
  ddb,
  BUCKET_NAME,
  TABLE_NAME,
  DeleteObjectCommand,
  GetCommand,
  DeleteCommand,
} = require("./shared/aws");
const { json } = require("./shared/response");

exports.handler = async (event) => {
  try {
    const photoId = event.pathParameters?.photoId;

    if (!photoId) {
      return json(400, { error: "photoId is required" });
    }

    const getResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { photoId },
      })
    );

    if (!getResult.Item) {
      return json(404, { error: "Photo not found" });
    }

    const photo = getResult.Item;

    if (photo.s3Key) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: photo.s3Key,
        })
      );
    }

    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { photoId },
      })
    );

    return json(200, {
      message: "Photo deleted successfully",
      deleted: {
        photoId: photo.photoId,
        fileName: photo.fileName,
        s3Key: photo.s3Key,
      },
    });
  } catch (error) {
    console.error("delete-photo error", error);
    return json(500, { error: "Failed to delete photo" });
  }
};

