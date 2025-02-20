const { InfluxDB } = require('@influxdata/influxdb-client');
const config = require('../config/influxdb');

class InfluxService {
  constructor() {
    this.client = new InfluxDB({ url: config.url, token: config.token });
    this.queryApi = this.client.getQueryApi(config.org);
  }

  async getLosses({ window = null, version = config.version, timeRange = '24h' }) {
    let fluxQuery = `
      from(bucket: "${config.bucket}")
        |> range(start: -${timeRange})
        |> filter(fn: (r) => r["_measurement"] == "templar_metrics")
        |> filter(fn: (r) => r["role"] == "miner")
        |> filter(fn: (r) => r["version"] == "${version}")
        |> filter(fn: (r) => r["_field"] == "loss")
    `;

    if (window) {
      fluxQuery += `|> filter(fn: (r) => r["window"] == "${window}")`;
    }

    fluxQuery += `
        |> pivot(rowKey:["_time"], columnKey: ["uid"], valueColumn: "_value")
        |> sort(columns: ["_time"])
    `;

    try {
      const data = [];
      for await (const { values, tableMeta } of this.queryApi.iterateRows(fluxQuery)) {
        const o = tableMeta.toObject(values);
        // Convert the row into a more friendly format
        const timepoint = {
          time: o._time,
          window: o.window,
          losses: {}
        };
        
        // Extract losses for each UID
        Object.keys(o).forEach(key => {
          if (key.match(/^\d+$/)) { // If the key is a number (UID)
            timepoint.losses[key] = o[key];
          }
        });
        
        data.push(timepoint);
      }
      return data;
    } catch (error) {
      console.error('Error querying InfluxDB:', error);
      throw error;
    }
  }

  async getAvailableVersions() {
    const fluxQuery = `
      from(bucket: "${config.bucket}")
        |> range(start: -24h)
        |> filter(fn: (r) => r["_measurement"] == "templar_metrics")
        |> filter(fn: (r) => r["role"] == "miner")
        |> group(columns: ["version"])
        |> distinct(column: "version")
    `;

    try {
      const versions = new Set();
      for await (const { values, tableMeta } of this.queryApi.iterateRows(fluxQuery)) {
        const o = tableMeta.toObject(values);
        versions.add(o.version);
      }
      return Array.from(versions);
    } catch (error) {
      console.error('Error querying versions from InfluxDB:', error);
      throw error;
    }
  }
}

module.exports = new InfluxService();