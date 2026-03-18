const {
  s3,
  ddb,
  BUCKET_NAME,
  TABLE_NAME,
  GetObjectCommand,
  HeadObjectCommand,
  ScanCommand,
  getSignedUrl,
} = require("./shared/aws");
const { json } = require("./shared/response");

exports.handler = async () => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    const items = (result.Items || [])
      .filter((item) => item && item.s3Key && item.contentType && item.contentType.startsWith("image/"))
      .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));

    const photoResults = await Promise.all(
      items.map(async (item) => {
        try {
          await s3.send(
            new HeadObjectCommand({
              Bucket: BUCKET_NAME,
              Key: item.s3Key,
            })
          );

          const getCommand = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: item.s3Key,
            ResponseContentType: item.contentType || "image/jpeg",
          });

          const imageUrl = await getSignedUrl(s3, getCommand, { expiresIn: 3600 });
          return { ...item, imageUrl };
        } catch (error) {
          console.log("Skipping bad gallery item", item.photoId, item.s3Key);
          return null;
        }
      })
    );

    return json(200, { photos: photoResults.filter(Boolean) });
  } catch (error) {
    console.error("get-photos error", error);
    return json(500, { error: "Failed to fetch photos" });
  }
};

