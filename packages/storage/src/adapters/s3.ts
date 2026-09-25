import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StorageAdapter, StorageConfig } from "../types";

type S3Config = Extract<StorageConfig, { provider: "s3" }>;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export class S3Adapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: false,

      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",

      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async getPresignedUploadUrl(params: {
    key: string;
    contentType: string;
    contentLength: number;
  }) {
    const isPublicImage = params.key.includes("/images/");

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
      ...(isPublicImage ? { ACL: "public-read" } : {}),
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 60 * 5,
    });

    const fileUrl = this.config.publicUrl
      ? `${trimTrailingSlash(this.config.publicUrl)}/${encodeKey(params.key)}`
      : `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${encodeKey(params.key)}`;

    return {
      uploadUrl,
      fileUrl,
      uploadHeaders: isPublicImage
        ? { "x-amz-acl": "public-read" }
        : undefined,
    };
  }

  async read(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`Storage object not found: ${key}`);
    }

    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async put(key: string, content: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: content,
        ContentLength: content.byteLength,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      keys.push(
        ...(page.Contents ?? []).flatMap((object) =>
          object.Key ? [object.Key] : [],
        ),
      );
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
  }
}
