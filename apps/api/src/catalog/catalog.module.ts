import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CategoryController } from './category.controller.js';
import { ProductController } from './product.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CategoryController, ProductController],
  providers: [CatalogService],
})
export class CatalogModule {}
