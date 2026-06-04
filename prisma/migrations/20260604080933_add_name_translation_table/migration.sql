-- CreateTable
CREATE TABLE "NameTranslation" (
    "firstName" TEXT NOT NULL,
    "hebrewFirstName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NameTranslation_pkey" PRIMARY KEY ("firstName")
);
