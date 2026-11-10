import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';
import { CatalogErrorFilter } from './catalog-error.filter.js';
import { LocalDevelopmentGuard } from './local-development.guard.js';
import { CatalogOperation } from './catalog.swagger.js';
import {
  productCreateSchema,
  productUpdateSchema,
  productQuerySchema,
  idSchema,
  type ProductCreate,
  type ProductUpdate,
  type ProductQuery,
} from './catalog.schemas.js';
import type { Product } from '../generated/prisma/client.js';
// Explicit two-decimal strings keep the wire contract independent of Decimal JSON formatting.
const present = (p: Product) => ({
  ...p,
  costPrice: p.costPrice.toFixed(2),
  sellingPrice: p.sellingPrice.toFixed(2),
});

@ApiTags('products')
@UseFilters(CatalogErrorFilter)
@UseGuards(LocalDevelopmentGuard)
@Controller('products')
export class ProductController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @Post()
  @CatalogOperation('product', 'create')
  async create(@Body({ schema: productCreateSchema }) body: ProductCreate) {
    return { data: present(await this.catalog.createProduct(body)) };
  }

  @Get()
  @CatalogOperation('product', 'list')
  async list(@Query({ schema: productQuerySchema }) query: ProductQuery) {
    const result = await this.catalog.listProducts(query);
    return { ...result, data: result.data.map(present) };
  }

  @Get(':id')
  @CatalogOperation('product', 'detail')
  async detail(@Param('id', { schema: idSchema }) id: string) {
    return { data: present(await this.catalog.getProduct(id)) };
  }

  @Patch(':id')
  @CatalogOperation('product', 'update')
  async update(
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: productUpdateSchema }) body: ProductUpdate,
  ) {
    return { data: present(await this.catalog.updateProduct(id, body)) };
  }

  @Post(':id/archive')
  @CatalogOperation('product', 'archive')
  @HttpCode(200)
  async archive(@Param('id', { schema: idSchema }) id: string) {
    return { data: present(await this.catalog.archiveProduct(id)) };
  }
}
