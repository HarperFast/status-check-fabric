# @harperdb/status-check

![NPM Version](https://img.shields.io/npm/v/%40harperdb%2Fstatus-check)

This component enables controlling an instance's status based on a record in the database. This can be used by external systems to know the availability of a specific node.

Harper Fabric uses this to manage your cluster.

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

This method is used to set the status of the node to 200. The user must be a `superuser`. Anonymous requests are rejected with 401, and other users, including roles with write permissions to a `data.hdb_status` table, are rejected with 403.

```shell
curl -X POST http://localhost:9926/status --header "Authorization: Basic XXXXXXXXXXXX"
```

### DELETE

This method is used to set the status of the node to 404. The user must be a `superuser`. Anonymous requests are rejected with 401, and other users, including roles with write permissions to a `data.hdb_status` table, are rejected with 403.

```shell
curl -X DELETE http://localhost:9926/status --header "Authorization: Basic XXXXXXXXXXXX"
```

## Protocol exposure

The status resource is excluded from native MCP. The component registers its resource with `{ mcp: false }`, so Harper's native MCP application profile does not list it as `get_status`, `create_status`, or `delete_status` tools. Unexpected tools on a shared MCP mount can make other components, such as Reflex, refuse every MCP request.

## Compatibility

Requires Harper 5.2.1 or later. It is verified on Harper 5.2.1, the version the development lockfile resolves, and on Harper 5.3.2. Earlier versions are unsupported: the component imports `Resource` and `server` from the `harper` module, so it does not load on Harper 4.x. The integration tests run under both the default and the `native` module loader.

Updating an installed component takes effect only after the component is redeployed and Harper's workers reload it, for example with `harper deploy_component` and `restart=true`, or a restart. A node already on Harper 5.2.1 or later, including 5.3.2, needs no Harper upgrade.
