import { Injectable } from '@nestjs/common';

import {
  DATA_SOURCE_CATALOG,
  DataSourceCatalogItem,
  DataSourceStatus,
} from './data-sources.catalog';

export interface DataSourcesSummary {
  available: number;
  planned: number;
  future: number;
  total: number;
}

export interface DataSourcesResponse {
  items: DataSourceCatalogItem[];
  summary: DataSourcesSummary;
}

@Injectable()
export class DataSourcesService {
  findAll(): DataSourcesResponse {
    const summary = DATA_SOURCE_CATALOG.reduce(
      (accumulator, item) => {
        accumulator[this.summaryKey(item.status)] += 1;
        accumulator.total += 1;
        return accumulator;
      },
      { available: 0, planned: 0, future: 0, total: 0 },
    );

    return {
      items: DATA_SOURCE_CATALOG,
      summary,
    };
  }

  private summaryKey(status: DataSourceStatus): keyof Omit<DataSourcesSummary, 'total'> {
    if (status === 'AVAILABLE') return 'available';
    if (status === 'PLANNED') return 'planned';
    return 'future';
  }
}
