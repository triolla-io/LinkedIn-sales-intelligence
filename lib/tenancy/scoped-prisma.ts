import { prisma } from "@/lib/prisma";

/**
 * Returns a Prisma client extended with a soft org-scope guard on
 * Contact, SentMessage, LinkedinSession, SavedView, and SyncJob reads.
 *
 * The extension adds `ownerId` (or `senderId`) filtering automatically
 * so no query can accidentally return another tenant's rows.
 */
export function scopedPrisma(orgUserIds: string[]) {
  return prisma.$extends({
    query: {
      contact: {
        async findUnique({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
        async findMany({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
        async update({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
        async delete({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
      },
      sentMessage: {
        async findUnique({ args, query }) {
          args.where = { ...args.where };
          return query(args);
        },
        async findMany({ args, query }) {
          args.where = { ...args.where, senderId: { in: orgUserIds } };
          return query(args);
        },
      },
      linkedinSession: {
        async findUnique({ args, query }) {
          args.where = { ...args.where, userId: { in: orgUserIds } as any };
          return query(args);
        },
      },
      savedView: {
        async findMany({ args, query }) {
          args.where = { ...args.where, ownerId: { in: orgUserIds } };
          return query(args);
        },
      },
      syncJob: {
        async findMany({ args, query }) {
          args.where = { ...args.where, userId: { in: orgUserIds } };
          return query(args);
        },
      },
    },
  });
}
