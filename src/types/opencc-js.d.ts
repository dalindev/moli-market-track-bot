declare module 'opencc-js' {
  interface ConverterOptions {
    from: 'cn' | 'tw' | 'twp' | 'hk' | 'jp' | 't';
    to: 'cn' | 'tw' | 'twp' | 'hk' | 'jp' | 't';
  }

  type ConverterFunction = (text: string) => string;

  export function Converter(options: ConverterOptions): ConverterFunction;
  export function CustomConverter(dict: Array<[string, string]>): ConverterFunction;
}
