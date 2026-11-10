import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CrmService } from './crm.service.js';
import {
  LeadsController,
  CustomersController,
  ActivitiesController,
  FollowUpsController,
} from './crm.controller.js';
@Module({
  imports: [PrismaModule],
  providers: [CrmService],
  controllers: [
    LeadsController,
    CustomersController,
    ActivitiesController,
    FollowUpsController,
  ],
})
export class CrmModule {}
