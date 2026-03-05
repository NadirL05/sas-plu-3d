import { createUploadthing, type FileRouter } from "uploadthing/next";

const f = createUploadthing();

export const ourFileRouter = {
  sceneCaptureUploader: f({
    image: {
      maxFileSize: "4MB",
      maxFileCount: 1,
    },
  }).onUploadComplete(async ({ file }) => ({
    url: file.ufsUrl,
  })),
  pluPdfUploader: f({
    pdf: {
      maxFileSize: "16MB",
      maxFileCount: 1,
    },
  }).onUploadComplete(async ({ file }) => ({
    url: file.ufsUrl,
  })),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
