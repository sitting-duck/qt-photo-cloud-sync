#!/usr/bin/env bash

set -e

FILE="$1"

if [ -z "$FILE" ]; then
  echo "Usage: ./upload.sh <file>"
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE"
  exit 1
fi

FILENAME=$(basename "$FILE")
CONTENT_TYPE=$(file --mime-type -b "$FILE")
SIZE_BYTES=$(stat -f%z "$FILE")
HASH=$(shasum -a 256 "$FILE" | awk '{print $1}')

echo "File: $FILENAME"
echo "Content-Type: $CONTENT_TYPE"
echo "Size: $SIZE_BYTES"
echo "Hash: $HASH"
echo ""

echo "→ Requesting presigned URL..."

PRESIGN_RESPONSE=$(curl -s -X POST http://localhost:3000/upload-url \
  -H "Content-Type: application/json" \
  -d "{
    \"fileName\": \"$FILENAME\",
    \"contentType\": \"$CONTENT_TYPE\",
    \"sizeBytes\": $SIZE_BYTES,
    \"fileHash\": \"$HASH\"
  }")

echo "$PRESIGN_RESPONSE" | jq .

DUPLICATE=$(echo "$PRESIGN_RESPONSE" | jq -r '.duplicate')

if [ "$DUPLICATE" = "true" ]; then
  echo "Duplicate detected. Skipping upload."
  exit 0
fi

UPLOAD_URL=$(echo "$PRESIGN_RESPONSE" | jq -r '.uploadUrl')
PHOTO_ID=$(echo "$PRESIGN_RESPONSE" | jq -r '.photoId')
S3_KEY=$(echo "$PRESIGN_RESPONSE" | jq -r '.s3Key')

echo ""
echo "→ Uploading to S3..."

curl -s -X PUT "$UPLOAD_URL" \
  -H "Content-Type: $CONTENT_TYPE" \
  --data-binary @"$FILE"

echo "Upload complete."

echo ""
echo "→ Finalizing metadata..."

FINAL_RESPONSE=$(curl -s -X POST http://localhost:3000/upload-complete \
  -H "Content-Type: application/json" \
  -d "{
    \"photoId\": \"$PHOTO_ID\",
    \"fileName\": \"$FILENAME\",
    \"s3Key\": \"$S3_KEY\",
    \"contentType\": \"$CONTENT_TYPE\",
    \"sizeBytes\": $SIZE_BYTES,
    \"fileHash\": \"$HASH\"
  }")

echo "$FINAL_RESPONSE" | jq .

echo ""
echo "Done."

