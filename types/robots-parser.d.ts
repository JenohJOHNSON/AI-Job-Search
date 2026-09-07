declare module "robots-parser" {
  type Robots = { isAllowed(url: string, userAgent?: string): boolean | undefined };
  export default function robotsParser(url: string, contents: string): Robots;
}
