import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ReportingService } from './reporting.service.js';
import {
  ReportsController,
  DashboardController,
  AuditLogsController,
} from './reporting.controller.js';
@Module({
  imports: [PrismaModule],
  providers: [ReportingService],
  controllers: [ReportsController, DashboardController, AuditLogsController],
})
export class ReportingModule {}
