import { registerDecorator, ValidationOptions } from 'class-validator';

export function isIpv4Cidr(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const [address, rawPrefix, ...extra] = value.trim().split('/');
  if (!address || rawPrefix === undefined || extra.length > 0) return false;

  const octets = address.split('.');
  const prefix = Number(rawPrefix);

  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number.isInteger(prefix) &&
    prefix >= 0 &&
    prefix <= 32
  );
}

export function IsIpv4Cidr(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isIpv4Cidr',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: isIpv4Cidr,
        defaultMessage: () => 'each CIDR must be a valid IPv4 CIDR',
      },
    });
  };
}
