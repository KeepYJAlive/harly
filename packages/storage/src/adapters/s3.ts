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

function prefixKey(key: string, prefix?: string) {
  if (!prefix) return key;

  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return normalizedPrefix ? `${normalizedPrefix}/${key}` : key;
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
    const objectKey = prefixKey(params.key, this.config.prefix);

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: objectKey,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 60 * 5,
    });

    const fileUrl = this.config.publicUrl
      ? `${trimTrailingSlash(this.config.publicUrl)}/${encodeKey(objectKey)}`
      : `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${encodeKey(objectKey)}`;

    return {
      uploadUrl,
      fileUrl,
    };
  }

  async read(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: prefixKey(key, this.config.prefix),
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
        Key: prefixKey(key, this.config.prefix),
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
        Key: prefixKey(key, this.config.prefix),
      }),
    );
  }

  async list(prefix: string) {
    const keys: string[] = [];
    const storagePrefix = this.config.prefix
      ? `${this.config.prefix.replace(/^\/+|\/+$/g, "")}/`
      : "";

    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefixKey(prefix, this.config.prefix),
          ContinuationToken: continuationToken,
        }),
      );
      keys.push(
        ...(page.Contents ?? []).flatMap((object) =>
          object.Key
            ? [
                storagePrefix && object.Key.startsWith(storagePrefix)
                  ? object.Key.slice(storagePrefix.length)
                  : object.Key,
              ]
            : [],
        ),
      );
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
  }
}
