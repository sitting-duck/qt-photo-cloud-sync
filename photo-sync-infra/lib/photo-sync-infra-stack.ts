import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class PhotoSyncInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'PhotoBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedOrigins: ['http://localhost:3000', 'http://localhost:8000'],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.HEAD,
          ],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
    });

    const table = new dynamodb.Table(this, 'PhotoTable', {
      partitionKey: { name: 'photoId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'fileHash-index',
      partitionKey: { name: 'fileHash', type: dynamodb.AttributeType.STRING },
    });

    const lambdaEnv = {
      BUCKET_NAME: bucket.bucketName,
      TABLE_NAME: table.tableName,
    };

    const uploadUrlFn = new lambda.Function(this, 'UploadUrlFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'upload-url.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: lambdaEnv,
    });

    const uploadCompleteFn = new lambda.Function(this, 'UploadCompleteFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'upload-complete.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: lambdaEnv,
    });

    const getPhotosFn = new lambda.Function(this, 'GetPhotosFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'get-photos.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: lambdaEnv,
    });

    const deletePhotoFn = new lambda.Function(this, 'DeletePhotoFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'delete-photo.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: lambdaEnv,
    });

    bucket.grantReadWrite(uploadUrlFn);
    bucket.grantReadWrite(uploadCompleteFn);
    bucket.grantReadWrite(getPhotosFn);
    bucket.grantReadWrite(deletePhotoFn);

    table.grantReadWriteData(uploadUrlFn);
    table.grantReadWriteData(uploadCompleteFn);
    table.grantReadWriteData(getPhotosFn);
    table.grantReadWriteData(deletePhotoFn);

    const api = new apigateway.RestApi(this, 'PhotoSyncApi', {
      restApiName: 'Photo Sync Service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
      },
    });

    const uploadUrlResource = api.root.addResource('upload-url');
    uploadUrlResource.addMethod('POST', new apigateway.LambdaIntegration(uploadUrlFn));

    const uploadCompleteResource = api.root.addResource('upload-complete');
    uploadCompleteResource.addMethod('POST', new apigateway.LambdaIntegration(uploadCompleteFn));

    const photosResource = api.root.addResource('photos');
    photosResource.addMethod('GET', new apigateway.LambdaIntegration(getPhotosFn));

    const photoByIdResource = photosResource.addResource('{photoId}');
    photoByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(deletePhotoFn));

    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
    });
  }
}