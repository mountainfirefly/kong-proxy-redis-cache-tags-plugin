const { default: TagCache } = require('redis-tag-cache');
const md5 = require('md5');

class CacheEntity {
  constructor(config) {
    this.config = config;
    this.cache = new TagCache({
      defaultTimeout: 86400,
      redis: {
        keyPrefix: 'cache:',
        ...this.parseRedisConfig(config),
      },
    });
  }

  parseRedisConfig(config) {
    const defaultValues = {
      host: 'localhost',
      port: 6379,
    }

    return Object.keys(config).reduce((sofar, configKey) => {
      if (configKey.includes('redis_')) {
        const newKey = configKey.replace('redis_', '');
        sofar[newKey] = config[configKey];

        if (!sofar[newKey]) {
          sofar[newKey] = defaultValues[newKey];
        }
      }

      return sofar;
    }, {});
  }

  async store(key, value, tags) {
    await this.cache.set(key, value, tags);
  }

  async get(key) {
    return await this.cache.get(key);
  }

  async invalidateCache(tags) {
    const promises = tags.map((tag) => {
      return this.cache.invalidate(tag);
    });

    return Promise.all(promises);
  }

  async access(kong) {
    const requestMethod = await kong.request.getMethod();
    const path = await kong.request.getPathWithQuery();
    const hash = md5(path);

    if (path?.includes('invalidate_cache')) {
      let cacheKeys = await kong.request.get_query_arg("cache_tags");

      if (cacheKeys) {
        cacheKeys = cacheKeys.split(',');
      }

      if (cacheKeys.length) {
        await this.invalidateCache(cacheKeys);
      }

      return kong.response.exit(200, {removed: true});
    }

    if (requestMethod === 'GET') {
      const cachedEntity = await this.get(`cache:${hash}`);

      if (cachedEntity !== null) {
        if (cachedEntity.body) {
          return kong.response.exit(200, JSON.parse(cachedEntity.body), {...cachedEntity.headers, 'x-cache-status': ['HIT']});
        }
      }

      await kong.service.request.addHeader("Cache-Control", "no-cache")
    }
  }

  async rewrite(kong) {
    await kong.service.request.enableBuffering();
  }

  async response(kong) {
    let cacheTags = await kong.response.getHeader('x-cache-tags');

    const source = await kong.response.getSource();
    const requestMethod = await kong.request.getMethod();
    const path = await kong.request.getPathWithQuery();
    const hash = md5(path);

    cacheTags = cacheTags ? cacheTags.split(',') : [`cache:${hash}`];

    let invalidateCacheTags = await kong.response.getHeader('x-invalidate-cache-tags');

    if (invalidateCacheTags) {
      invalidateCacheTags = invalidateCacheTags.split(',');

      await this.invalidateCache(invalidateCacheTags);
    }

    if (source == 'service') {
      let body = await kong.service.response.getRawBody();
      const contentType = await kong.service.response.getHeader('Content-Type');

      const headers = await kong.response.getHeaders();

      if (requestMethod === 'GET') {
        await kong.response.setHeader('x-cache-key', `cache:${hash}`);
        await kong.response.setHeader('x-cache-status', `MISS`);
        await kong.response.setHeader('Cache-Control', 'no-cache');

        await this.store(
          `cache:${hash}`,
          {
            body,
            headers: {
              ...headers,
              'x-cache-key': [`cache:${hash}`],
            },
          },
          cacheTags,
        );
      }

      const code = await kong.response.getStatus();

      return kong.response.exit(code, body);
    }
  }
}

module.exports = {
  Plugin: CacheEntity,
  Schema: [
    { use_prefix: { type: 'boolean', default: true }},
    { redis_host: { type: 'string', default: 'localhost' }},
    { redis_port: { type: 'number', default: 6379 }}
  ],
  Version: '0.1.0',
};
