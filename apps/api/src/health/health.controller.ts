import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck } from '@nestjs/terminus';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check API and PostgreSQL connectivity' })
  @ApiResponse({ status: 200, description: 'Database is reachable' })
  @ApiResponse({ status: 503, description: 'Database is unavailable' })
  check() {
    return this.health.check();
  }
}
