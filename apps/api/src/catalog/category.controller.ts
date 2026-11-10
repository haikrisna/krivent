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
  categoryCreateSchema,
  categoryUpdateSchema,
  categoryQuerySchema,
  idSchema,
  type CategoryCreate,
  type CategoryUpdate,
  type CategoryQuery,
} from './catalog.schemas.js';
const present = <T>(value: T) => value;

@ApiTags('categories')
@ApiBearerAuth('access-token')
@Roles('ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF')
@Controller('categories')
export class CategoryController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @Post()
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @CatalogOperation('category', 'create')
  async create(@Body({ schema: categoryCreateSchema }) body: CategoryCreate) {
    return { data: present(await this.catalog.createCategory(body)) };
  }

  @Get()
  @CatalogOperation('category', 'list')
  async list(@Query({ schema: categoryQuerySchema }) query: CategoryQuery) {
    const result = await this.catalog.listCategories(query);
    return { ...result, data: result.data.map(present) };
  }

  @Get(':id')
  @CatalogOperation('category', 'detail')
  async detail(@Param('id', { schema: idSchema }) id: string) {
    return { data: present(await this.catalog.getCategory(id)) };
  }

  @Patch(':id')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @CatalogOperation('category', 'update')
  async update(
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: categoryUpdateSchema }) body: CategoryUpdate,
  ) {
    return { data: present(await this.catalog.updateCategory(id, body)) };
  }

  @Post(':id/archive')
  @Roles('ADMIN')
  @CatalogOperation('category', 'archive')
  @HttpCode(200)
  async archive(@Param('id', { schema: idSchema }) id: string) {
    return { data: present(await this.catalog.archiveCategory(id)) };
  }
}
