# @harperdb/status-check

![NPM Version](https://img.shields.io/npm/v/%40harperdb%2Fstatus-check)

This component enables controlling an instance's status based on a record in the database. This can be used by external systems to know the availability of a specific node.

Fabric uses this to manage your cluster.

The status of the node can be
- retrieved with `GET /status`
- set to `200` with `POST /status`
- set to `404` with `DELETE /status`

NOTE: Replication for the `data.hdb_status` table should NOT be established.  If the data replicates then all other nodes would be unintentionally set to offline/online.

## Usage

This component exposes a route `/status`

### GET

This method is unauthenticated and returns the current status and message.

```shell
curl http://localhost:9926/status
```

### POST

This method is used to set the status of the node to 200. This method is authenticated and the user must either be a `superuser` or have write permissions to the table `data.hdb_status`.

```shell
curl -X POST http://localhost:9926/status --header "Authorization: Basic XXXXXXXXXXXX"
```

### DELETE

This method is used to set the status of the node to 404. This method is authenticated and the user must either be a `superuser` or have write permissions to the table `data.hdb_status`.

```shell
curl -X DELETE http://localhost:9926/status --header "Authorization: Basic XXXXXXXXXXXX"
```
