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
@UseFilters(CatalogErrorFilter)
@UseGuards(LocalDevelopmentGuard)
@Controller('categories')
export class CategoryController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @Post()
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
  @CatalogOperation('category', 'update')
  async update(
    @Param('id', { schema: idSchema }) id: string,
    @Body({ schema: categoryUpdateSchema }) body: CategoryUpdate,
  ) {
    return { data: present(await this.catalog.updateCategory(id, body)) };
  }

  @Post(':id/archive')
  @CatalogOperation('category', 'archive')
  @HttpCode(200)
  async archive(@Param('id', { schema: idSchema }) id: string) {
    return { data: present(await this.catalog.archiveCategory(id)) };
  }
}
