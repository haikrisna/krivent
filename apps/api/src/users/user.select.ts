import type { Prisma } from '../generated/prisma/client.js';

export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;
export type AuthenticatedUser = PublicUser & { sessionId: string };
export function presentUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
