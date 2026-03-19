// @flow
import React, { Component } from 'react'
import marked from 'marked'
import { Link } from 'react-router-dom'
import {
  Loader,
  Dimmer,
  Button,
  Card,
} from 'semantic-ui-react'

import style from './MainView.css'

marked.setOptions({
  gfm: true,
  tables: true,
  breaks: true,
  pedantic: false,
  sanitize: true,
  smartLists: true,
  smartypants: false,
})

const ListItem = (props: {
  id: number,
  list: string,
}) => (
  <Card id={`list_${props.id}`}>
    <Card.Content>
      <div
        className={style.list_preview}
        dangerouslySetInnerHTML={{ __html: marked(props.list) }}
      />
    </Card.Content>
    <Card.Content extra style={{ textAlign: 'center' }}>
      {[
        { content: 'View', url: 'view', color: 'blue', icon: 'unhide' },
        { content: 'Edit', url: 'edit', color: 'green', icon: 'edit' },
        { content: 'Share', url: 'share', color: 'yellow', icon: 'send' },
      ].map(e =>
        <Button
          key={e.content}
          {...e}
          as={Link}
          to={`/${e.url}/${props.id}`}
          size="tiny"
        />)}
    </Card.Content>
  </Card>
)

const Loading = () => (
  <Dimmer inverted active>
    <Loader inline="centered" indeterminate>
      Loading
    </Loader>
  </Dimmer>
)

export default class MainList extends Component {
  state = {
    data: [],
  }

  componentDidMount() {
    fetch('/api/v1/list')
      .then(x => x.json())
      .then(x => x.body)
      .then(data => this.setState({ data }))
  }

  render() {
    const { data } = this.state

    return (
      <div style={{ padding: '10px' }}>
        <div style={{ paddingBottom: '10px' }}>
          <Button color="green" as={Link} to="/new" icon="write" content="New" />
        </div>

        <Card.Group doubling>
          {data.length > 0
            ? data.map(e => <ListItem key={e.id} {...e} />)
            : <Loading />}
        </Card.Group>
      </div>
    )
  }
}
