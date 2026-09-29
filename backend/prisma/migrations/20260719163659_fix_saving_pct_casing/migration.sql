/*
  Warnings:

  - You are about to drop the column `SavingPct` on the `empty_legs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "empty_legs" DROP COLUMN "SavingPct",
ADD COLUMN     "savingPct" INTEGER;
