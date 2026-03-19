# QT Photo Sync Demo

A small AWS-based photo sync prototype built for demo/interview purposes.

## What it does

- Uploads photos from a browser using a presigned S3 URL
- Stores photo metadata in DynamoDB
- Detects duplicate uploads using a SHA-256 file hash
- Lists uploaded photos in a gallery
- Deletes photos from both S3 and DynamoDB

## Architecture

- **S3**: stores the image files
- **DynamoDB**: stores photo metadata
- **Lambda**: backend logic
- **API Gateway**: HTTP endpoints
- **Static frontend**: simple HTML page served locally

## API endpoints

- `POST /upload-url`
- `POST /upload-complete`
- `GET /photos`
- `DELETE /photos/{photoId}`

## Project structure

```text
photo-sync-infra/
├── bin/
├── frontend/
│   └── index.html
├── lambda/
│   ├── upload-url.js
│   ├── upload-complete.js
│   ├── get-photos.js
│   ├── delete-photo.js
│   └── shared/
├── lib/
│   └── photo-sync-infra-stack.ts
├── package.json
└── setup.sh

