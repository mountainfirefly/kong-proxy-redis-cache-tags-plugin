# Kong Proxy Cache plugin

This is a custom plugin for Kong which provides a reverse cache implementation. It caches response entities based on the provided configurations. It does most things very similar to the kong official [proxy cache plugin](https://docs.konghq.com/hub/kong-inc/proxy-cache/) so I won’t go into detail explaining everything instead I will mention the enhancements that have been made.

Github Link for this plugin: https://github.com/mountainfirefly/kong-proxy-redis-cache-tags-plugin

### Enhancements

- This plugin is written in javascript, (So javascript developers, this might serve as motivation for you to write kong plugins in Javascript rather than Lua)
- How to purge the cache entities before their expiration time
    - Purge cache using cache key
    - Purge cache using `x-invalidate-cache-tags` header
- Use of Redis to store the cached entities

## Configuration

Apart from configuring Redis and invalidating the (`/invalidate-cache`) endpoint, we don’t have much to configure.

| Parameter | Type | Description |
| --- | --- | --- |
| defaultTimeout | number | Number of seconds to invalidate records, default value 86400 |
| redis_host | string | Redis hostname, the default value is localhost |
| redis_port | number | Port of the Redis server, the default value is 6379 |

### Cache Key

This plugin cache’s each cache element based on the request URL. It generates a unique identifier from it using the `md5` NPM package. Currently, this key generation is hard-coded and cannot be re-adjusted but It is possible to pre-calculate the cache key for any request and you can do it like mentioned below.

```jsx
let key = md5(request.url);
```

This plugin will deliver the cache key related to the requested resource in `x-cache-key` response header.

### Cache Tags

A cache tag is a string and cache tags are passed around in sets of strings.

Nowadays, people are using cache tags to provide a declarative way to track which cache items depend on respective data. A tag could be linked with multiple cache entities and invalidation of that tag will trigger the purging of all the cache entities linked to it.

For every resource, you can have more than one cache tag and they work similarly to cache keys. The primary distinction is that any cache resource can have its `x-cache-tags` header manually set by the user from the upstream, which is how cache tags are set.

## Different ways to Invalidate cache records

### Option 1: Invalidate records using invalidate cache endpoint.

1. Configure the invalidation endpoint (`/invalidate-cache`)
    
    To configure the invalidate endpoint we have to add it to one of the routes in `kong.yml` config file. It is a temporary solution, for now, we will be implementing a more reliable solution in the future.
    
    ```yaml
    _format_version: '2.1'
    
    # _transform is optional, defaulting to true.
    # It specifies whether schema transformations should be applied when importing this file
    # as a rule of thumb, leave this setting to true if you are importing credentials
    # with plain passwords, which need to be encrypted/hashed before storing on the database.
    # On the other hand, if you are reimporting a database with passwords already encrypted/hashed,
    # set it to false.
    
    _transform: true
    
    # Each Kong entity (core entity or custom entity introduced by a plugin)
    # can be listed in the top-level as an array of objects:
    services:
      - name: redis-cache-service
        url: https://anime-facts-rest-api.herokuapp.com
    routes:
      - name: user-books-list
        service: redis-cache-service
        paths:
          - /api/v1
    			- /invalidate-cache # <--- Added here
    			- /api/v1/(?<appcode>\.*)
        strip_path: false
    plugins:
      - name: cache-entity
        config:
          redis_host: 'redis'
          redis_port: 6379
          use_prefix: false
    ```
    
2. Now use, the configured invalidation endpoint (`/invalidate-cache`) to purge cache records
    
    You can trigger the below endpoint for multiple cache keys or cache tags in the query params.
    
    ```yaml
    http://localhost:8000/invalidate_cache?cache_tags=cacheKey1,cacheKey2
    ```
    
    NOTE: Replace the origin with your kong API gateway. Currently, my kong API gateway is pointing to `http://localhost:8000`
    

### Option 2: Invalidate using `x-invalidate-cache-tags` header.

Using this method we can purge the cache entities from the upstream server, all we have to do is attach the `x-invalidate-cache-tags` header with cache tags values in the upstream response that you would like to invalidate. 

You can attach this `x-invalidate-cache-tags` header to the response from the upstream server in the below format.

## Understand this plugin’s working with an example

Suppose we have two below endpoints `book` and `author` and in order to cache these, follow the below steps.

Book  `GET` `/book/book_101`

```json
{
  "id": "book_101",
  "type": "book",
  "title": "Braiding Sweetgrass",
  "published": 2013,
  "language": "English",
  "pages": 408,
  "author": {
    "id": "author_101",
    "name": "Robin Wall Kimmerer"
  }
}
```

Author `GET` `/author/author_101`

```json
{
  "id": "author_101",
  "type": "author",
  "name": "Robin Wall Kimmerer"
}
```

### Steps

- We have to add below configs to the `kong.yml` file under routes
    
    ```yaml
    routes:
      - name: user-articles-list
        service: redis-cache-service
        paths:
          - /api/v1
          - /invalidate-cache
          - /author/(?<appcode>\.*) # Author endpoint
          - /book/(?<appcode>\.*) # Book endpoint
        strip_path: false
    ```
    
- When the `/book/book_101` request goes via the kong to the upstream server.  The `x-cache-tag`  header has to be set to the response on the upstream server with values author and book Id(`book_101,author_101` ).
- When this response reaches back to Kong from upstream, it can read `x-cache-tag` response header and set `cache_tags` for this book request.
    - Make sure the response header name should be `x-cache-tags` with values like the one below from the upstream server.
        
        ```yaml
        x-cache-tags:book_101,author_101 # These are actual book ID and author ID
        ```
        
- Now you update the author name by doing a PATCH. You can invalidate the book cached response either using the `/invalidate-cache` endpoint or  `x-invalidate-cache-tags` header
Here we are updating the author name.
    
    ```yaml
    PATCH author/author_101
    
    {
      "id": "author_101",
      "type": "author",
      "name": "Robin Hood"
    }
    ```
    
    - If you do with `/invalidate-cache` endpoint, you just have to call this endpoint with the author ID like below. It’ll invalidate all the records which are linked to this author Id.
    
    ```yaml
    http://localhost:8000/invalidate_cache?cache_tags=author_101
    # This happens because we have linked the book to this author_101 in the last point.
    ```
    
    - Second option is using `x-invalidate-cache-tags` response header, for this to work, you have to add `x-invalidate-cache-tags` header in the PATCH response of author endpoint from from the upstream server.
    Like below with the author ID.
        
        ```yaml
        x-invalidate-cache-tags:author_101
        ```
        
        Note: When kong reads this header from the upstream server it automatically invalidates all the records which are associated with this author Id.
        
        Make sure you have the PATCH route mentioned in the kong.yml and don’t worry this plugin only caches GET requests.
        
        ```yaml
        routes:
          - name: user-articles-list
            service: redis-cache-service
            paths:
              - /api/v1
              - /invalidate-cache
              - /author/(?<appcode>\.*) # PATCH request to be mentioned here
              - /book/(?<appcode>\.*) 
            strip_path: false
        ```
        

- Now doing GET for the book will give us updated author details because this goes directly to the upstream server. The below book response will always be cached for subsequent requests.
    
    ```json
    {
      "id": "book_101",
      "type": "book",
      "title": "Braiding Sweetgrass",
      "published": 2013,
      "language": "English",
      "pages": 408,
      "author": {
        "id": "author_101",
        "name": "Robin Hood"
      }
    }
    ```
    

If you want to know how kong cache plugin works here is official link [https://docs.konghq.com/hub/kong-inc/proxy-cache/](https://docs.konghq.com/hub/kong-inc/proxy-cache/) and if you have any questions and suggestion related to this plugin do reach out to me on [linked](https://www.linkedin.com/in/mountainfirefly/) 

This is all for this article, thank you so much for reading it. 

I hope you have enjoyed it and found it helpful.
See you next time ✌️
