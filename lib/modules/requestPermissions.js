/* @flow */

import { Module } from '../core/module';

export const module: Module<{ [string]: any }> = new Module('requestPermissions');

module.moduleName = 'requestPermissionsName';
module.description = 'requestPermissionsDesc';
module.category = 'aboutCategory';
module.disabledByDefault = true;
module.permissions = {
	get requiredPermissions() { return (chrome: any).runtime.getManifest().optional_permissions; }, // eslint-disable-line no-undef
};
