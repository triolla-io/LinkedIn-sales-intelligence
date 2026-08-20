-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "radarInclude" BOOLEAN;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "radarScheduleEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TrackedCompany" ADD COLUMN     "autoAdded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "staffCount" INTEGER;

