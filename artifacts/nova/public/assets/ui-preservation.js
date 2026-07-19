/*
 * NovaLuis UI compatibility layer
 *
 * Drizzle returns camelCase fields (imageUrl, scheduledAt, ...), while the
 * existing handwritten Scheduled renderer reads legacy snake_case aliases
 * (image_url, scheduled_at, ...). Normalize that one response without changing
 * API routes, database columns, request bodies, or the established renderer.
 */
(function installNovaUiPreservation() {
  'use strict';

  if (window.__novaUiPreservationInstalled || typeof window.fetch !== 'function') return;
  window.__novaUiPreservationInstalled = true;

  var originalFetch = window.fetch.bind(window);
  var FIELD_PAIRS = [
    ['campaignId', 'campaign_id'],
    ['intervalHours', 'interval_hours'],
    ['contentType', 'content_type'],
    ['imageUrl', 'image_url'],
    ['videoUrl', 'video_url'],
    ['aspectRatio', 'aspect_ratio'],
    ['referenceImageId', 'reference_image_id'],
    ['scheduledAt', 'scheduled_at'],
    ['publishedAt', 'published_at'],
    ['errorMessage', 'error_message'],
    ['composioResult', 'composio_result'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at'],
  ];

  function requestMethod(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input && typeof input === 'object' && input.method) return String(input.method).toUpperCase();
    return 'GET';
  }

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function isScheduleListRequest(input, init) {
    if (requestMethod(input, init) !== 'GET') return false;
    try {
      var url = new URL(requestUrl(input), window.location.origin);
      return url.pathname === '/api/social/schedule';
    } catch (_) {
      return false;
    }
  }

  function addAliases(post) {
    if (!post || typeof post !== 'object' || Array.isArray(post)) return post;
    FIELD_PAIRS.forEach(function (pair) {
      var camel = pair[0];
      var snake = pair[1];
      if (post[snake] == null && post[camel] != null) post[snake] = post[camel];
      if (post[camel] == null && post[snake] != null) post[camel] = post[snake];
    });
    return post;
  }

  window.fetch = function novaUiPreservingFetch(input, init) {
    var shouldNormalize = isScheduleListRequest(input, init);
    return originalFetch(input, init).then(function (response) {
      if (!shouldNormalize || !response || !response.ok) return response;

      return response.clone().json().then(function (payload) {
        if (!payload || !Array.isArray(payload.posts)) return response;
        payload.posts = payload.posts.map(addAliases);

        /* Keep the original Response object and body semantics. The renderer
           calls json(), so override only that instance method with normalized
           data instead of constructing a replacement Response that loses url,
           redirected, type, and other browser-managed metadata. */
        response.json = function () {
          return Promise.resolve(payload);
        };
        return response;
      }).catch(function () {
        return response;
      });
    });
  };
})();
