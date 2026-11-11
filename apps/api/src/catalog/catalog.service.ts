import { audit } from '../audit/audit.js';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CategoryCreate,
  CategoryUpdate,
  CategoryQuery,
  ProductCreate,
  ProductUpdate,
  ProductQuery,
} from './catalog.schemas.js';

@Injectable()
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // A serializable write prevents category archive racing with product creation/reassignment.
  private async write<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(run, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  }

  private async category(
    tx: Prisma.TransactionClient,
    id: string,
    active = false,
  ) {
    const value = await tx.category.findUnique({ where: { id } });
    if (!value) throw new NotFoundException('Category not found');
    if (active && !value.isActive)
      throw new ConflictException('Category is archived');
    return value;
  }

  private async product(
    tx: Prisma.TransactionClient,
    id: string,
    active = false,
  ) {
    const value = await tx.product.findUnique({ where: { id } });
    if (!value) throw new NotFoundException('Product not found');
    if (active && !value.isActive)
      throw new ConflictException('Product is archived');
    return value;
  }

  createCategory(data: CategoryCreate) {
    return this.prisma.category.create({ data });
  }
  getCategory(id: string) {
    return this.category(this.prisma, id);
  }
  updateCategory(id: string, data: CategoryUpdate) {
    return this.write(async (tx) => {
      await this.category(tx, id, true);
      return tx.category.update({ where: { id }, data });
    });
  }
  archiveCategory(id: string) {
    return this.write(async (tx) => {
      await this.category(tx, id);
      if (await tx.product.count({ where: { categoryId: id, isActive: true } }))
        throw new ConflictException(
          'Archive active products before archiving their category',
        );
      return tx.category.update({ where: { id }, data: { isActive: false } });
    });
  }
  createProduct(data: ProductCreate) {
    return this.write(async (tx) => {
      await this.category(tx, data.categoryId, true);
      return tx.product.create({ data });
    });
  }
  getProduct(id: string) {
    return this.product(this.prisma, id);
  }
  updateProduct(id: string, data: ProductUpdate, actorId: string) {
    return this.write(async (tx) => {
      const product = await this.product(tx, id, true);
      await this.category(tx, data.categoryId ?? product.categoryId, true);
      const updated = await tx.product.update({ where: { id }, data });
      if (
        !updated.costPrice.eq(product.costPrice) ||
        !updated.sellingPrice.eq(product.sellingPrice)
      )
        await audit(tx, actorId, 'PRODUCT_PRICE_CHANGED', 'PRODUCT', id, {
          costPrice: updated.costPrice.toFixed(2),
          sellingPrice: updated.sellingPrice.toFixed(2),
        });
      return updated;
    });
  }
  archiveProduct(id: string, actorId: string) {
    return this.write(async (tx) => {
      const product = await this.product(tx, id);
      const updated = await tx.product.update({
        where: { id },
        data: { isActive: false },
      });
      if (product.isActive)
        await audit(tx, actorId, 'PRODUCT_ARCHIVED', 'PRODUCT', id, {
          isActive: false,
        });
      return updated;
    });
  }

  listCategories(q: CategoryQuery) {
    const where: Prisma.CategoryWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status === 'active' }),
      ...(q.search
        ? { name: { contains: q.search, mode: 'insensitive' } }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const data = await tx.category.findMany({
          where,
          orderBy: [{ [q.sortBy]: q.direction }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        });
        const total = await tx.category.count({ where });
        return {
          data,
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total,
            totalPages: Math.ceil(total / q.pageSize),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  listProducts(q: ProductQuery) {
    const where: Prisma.ProductWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status === 'active' }),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { sku: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      sellingPrice: {
        ...(q.minPrice ? { gte: q.minPrice } : {}),
        ...(q.maxPrice ? { lte: q.maxPrice } : {}),
      },
    };
    return this.prisma.$transaction(
      async (tx) => {
        const data = await tx.product.findMany({
          where,
          orderBy: [{ [q.sortBy]: q.direction }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        });
        const total = await tx.product.count({ where });
        return {
          data,
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total,
            totalPages: Math.ceil(total / q.pageSize),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
