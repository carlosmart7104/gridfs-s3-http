'use strict';

import { GridFS } from '../lib';
import config from 'config';
import fs from 'fs';
import fnv from 'fnv-plus';
import _ from 'lodash';
import createError from 'http-errors';


export class GridFSServiceClass  {

  loadDefaultOptions() {
    return config.gridfs;
  }

  constructor(opts) {
    this._isReady = false;
    if (!opts) {
      this.opts = this.loadDefaultOptions();
    } else {
      this.opts = opts;
    }

    this._GridFSInstance = GridFS(this.opts);
    this._allowedOptions = ['_id', 'filename', 'metadata', 'root', 'content_type'];
  }

  async ensureConnection() {
    if (!this._GridFSInstance.isConnected()) {
      await this._GridFSInstance.connect();
      this._db = this._GridFSInstance.getDb();
    }

    await Promise.resolve();
  }

  getGrid(options) {
    return this._GridFSInstance.getGridFS(_.pick(options, 'root'));
  }

  exchangeFilenameToId(filename) {
    let str = fnv.hash(filename, 64).hex();
    const pad = 24 - str.length;
    for (let i = 0; i < pad; i++) {
      str += '0';
    }
    return str;
  }

  _patchOptions(_options) {
    const options = Object.assign({}, _.pick(_options, this._allowedOptions));
    options.metadata = Object.assign({}, options.metadata);

    if (options.filename) {
      options.metadata.filename = options.filename;
      options._id = this.exchangeFilenameToId(options.filename);
      options.filename = options._id;
    }

    if (options._id && typeof options._id === 'string') {
      options._id = this._GridFSInstance.getAdapter().ObjectId(options._id);
    }

    return options;
  }

  async postObject(input, _options) {
    await this.ensureConnection();

    const options = this._patchOptions(_options);

    if (!options._id) {
      throw new createError.BadRequest('Cannot create object without filename or _id');
    }

    return await new Promise((resolve, reject) => {
      this.getGrid(options).createWriteStream(options, (err, writestream) => {
        if (writestream) {
          const stream = input.pipe(writestream);
          stream.on('close', resolve);
          stream.on('err', reject);
        } else {
          // Stream couldn't be created because a write lock was not available
          reject(new createError.BadRequest('Locked'));
        }
      });
    });
  }

  async putObject(input, _options) {
    await this.ensureConnection();

    const options = this._patchOptions(_options);

    if (!options._id) {
      throw new createError.BadRequest('Cannot update object without filename or _id');
    }


    return await new Promise((resolve, reject) => {
      this.getGrid(options).createWriteStream(options, (err, writestream) => {
        if (writestream) {
          const stream = input.pipe(writestream);
          stream.on('close', resolve);
          stream.on('err', reject);
        } else {
          // Stream couldn't be created because a write lock was not available
          reject(new createError.BadRequest('Locked'));
        }
      });
    });
  }

  async getObject(_options) {
    const metadata = await this.getObjectMetadata(_options);

    if (!metadata) {
      throw createError.NotFound('Not found');
    }

    const content = await this.getObjectContent(_options);

    if (!content) {
      throw new createError.NotFound('Not found');
    }

    return { metadata, content };
  }

  async getObjectContent(_options) {
    await this.ensureConnection();

    const options = this._patchOptions(_options);

    if (!options._id) {
      throw new createError.BadRequest('Cannot get object without filename or _id');
    }

    return await new Promise((resolve, reject) => {
      this.getGrid(options).createReadStream(options, function (err, readstream) {
        if (readstream) {
          resolve(readstream);
        } else {
          // Stream couldn't be created because a read lock was not available
          reject(new createError.BadRequest('Locked'));
        }
      });
    });
  }

  async getObjectMetadata(_options) {
    await this.ensureConnection();

    const options = this._patchOptions(_options);

    if (!options._id) {
      throw new createError.BadRequest('Cannot get object metadata without filename or _id');
    }

    return await new Promise((resolve, reject) => {
      this
        ._db.collection(`${options.root}.files`)
        .findOne(_.pick(options, '_id'), (err, file) => {
          if (err) {
            reject(err);
          } else {
            resolve(file);
          }
        });
      });
  }

  async removeObject(_options) {
    await this.ensureConnection();

    const options = this._patchOptions(_options);

    if (!options._id) {
      throw new createError.BadRequest('Cannot remove object without filename or _id');
    }

    return await new Promise((resolve, reject) => {
      this.getGrid(options).remove(options, (err, result) => {
        if (err) {
          reject(err);
        } else if (result) {
          resolve(result);
        } else {
          reject(new createError.BadRequest('Failed to acquire lock'));
        }
      });
    });
  }

}

export const GridFSService = (opts) => new GridFSServiceClass(opts);
