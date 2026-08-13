/* @flow */

// load environment listeners
import './environment/background/ajax';
import './environment/background/download';
import './environment/background/firstRun';
import './environment/background/i18n';
import './environment/background/loadScript';
import './environment/background/localePersistor';
import { addListener } from './environment/background/messaging';
import './environment/background/multicast';
import './environment/background/oldRedditRedirect';
import './environment/background/pageAction';
import './environment/background/permissions';
import './environment/background/session';
import './environment/background/storage';
import './environment/background/tabs';
import './environment/background/xhrCache';

import { migrate } from './core/migrate';

migrate();

// Restoring a backup may require migrations to be run
addListener('runMigrations', migrate);
