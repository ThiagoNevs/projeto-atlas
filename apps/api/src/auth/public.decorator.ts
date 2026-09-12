import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = Symbol('atlas-public-route');
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
