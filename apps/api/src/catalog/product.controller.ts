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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';
import { Roles } from '../auth/roles.decorator.js';
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
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF')
@Controller('products')
export class ProductController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @Post()
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
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
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @CatalogOperation('product', 'update')
  async update(
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: productUpdateSchema }) body: ProductUpdate,
  ) {
    return { data: present(await this.catalog.updateProduct(id, body)) };
  }

  @Post(':id/archive')
  @Roles('ADMIN')
  @CatalogOperation('product', 'archive')
  @HttpCode(200)
  async archive(@Param('id', { schema: idSchema }) id: string) {
    return { data: present(await this.catalog.archiveProduct(id)) };
  }
}
